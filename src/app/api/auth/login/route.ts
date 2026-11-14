import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";

const SESSION_MAX_AGE = 60 * 60 * 24 * 180;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

async function ensureSessionUser(req: Request) {
  const sid = readCookie(req, SESSION_COOKIE);
  if (sid) {
    const existing = await prisma.user.findUnique({ where: { sessionKey: sid } });
    if (existing) return { user: existing, newSessionKey: undefined as string | undefined };
  }
  const sessionKey = randomBytes(24).toString("hex");
  const user = await prisma.user.create({
    data: {
      sessionKey,
      locale: "zh-CN",
      dailyGoalDefault: 20,
      clozeEnabled: true,
    },
  });
  return { user, newSessionKey: sessionKey };
}

export async function GET() {
  return NextResponse.json({
    gated: Boolean(process.env.APP_ACCESS_PASSWORD?.trim()),
  });
}

export async function POST(req: Request) {
  const gate = process.env.APP_ACCESS_PASSWORD?.trim();

  if (gate) {
    const body = await req.json().catch(() => ({}));
    if (String(body.password || "") !== gate) {
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }
  }

  const { user, newSessionKey } = await ensureSessionUser(req);
  const res = NextResponse.json({
    ok: true,
    gated: Boolean(gate),
    userId: user.id,
  });

  if (gate) {
    res.cookies.set("cw_unlocked", "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.NODE_ENV === "production",
    });
  }

  if (newSessionKey) {
    res.cookies.set(SESSION_COOKIE, newSessionKey, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  }

  return res;
}
