import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import type { User } from "@prisma/client";
import { prisma } from "./db";

export const SESSION_COOKIE = "cw_sid";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days

function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export type AuthResult = {
  user: User;
  /** 新会话时需写入响应 */
  newSessionKey?: string;
};

/**
 * 按 httpOnly 会话 cookie 绑定独立用户，避免共享 demo 账号。
 * 可选 APP_ACCESS_PASSWORD：设置后须先通过 /api/auth/login。
 */
export async function requireUser(req: Request): Promise<AuthResult> {
  const gate = process.env.APP_ACCESS_PASSWORD?.trim();
  if (gate) {
    const unlocked = parseCookieHeader(req.headers.get("cookie"))["cw_unlocked"];
    if (unlocked !== "1") {
      const err = new Error("需要登录");
      (err as Error & { status: number }).status = 401;
      throw err;
    }
  }

  const jar = parseCookieHeader(req.headers.get("cookie"));
  const sid = jar[SESSION_COOKIE];
  if (sid) {
    const existing = await prisma.user.findUnique({ where: { sessionKey: sid } });
    if (existing) return { user: existing };
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

export function withSessionCookie(res: NextResponse, newSessionKey?: string): NextResponse {
  if (newSessionKey) {
    res.cookies.set(SESSION_COOKIE, newSessionKey, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

export function jsonWithSession(data: unknown, auth: AuthResult, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  return withSessionCookie(res, auth.newSessionKey);
}

export function errorJson(e: unknown, fallbackStatus = 500) {
  const status =
    typeof e === "object" && e && "status" in e && typeof (e as { status: unknown }).status === "number"
      ? (e as { status: number }).status
      : fallbackStatus;
  const message = e instanceof Error ? e.message : "服务器错误";
  return NextResponse.json({ error: message }, { status });
}

/** Server Component / 页面侧读取当前用户（无则创建） */
export async function getPageUser(): Promise<User> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) {
    const existing = await prisma.user.findUnique({ where: { sessionKey: sid } });
    if (existing) return existing;
  }
  const sessionKey = randomBytes(24).toString("hex");
  const user = await prisma.user.create({
    data: { sessionKey, locale: "zh-CN", dailyGoalDefault: 20, clozeEnabled: true },
  });
  jar.set(SESSION_COOKIE, sessionKey, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return user;
}
