import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export async function POST(req: Request) {
  const sid = readCookie(req.headers.get("cookie"), SESSION_COOKIE);

  if (sid) {
    // 写回数据库使旧 cookie 立即失效；即使写库失败也要清浏览器 cookie
    try {
      await prisma.user.updateMany({
        where: { sessionKey: sid },
        data: { sessionKey: null },
      });
    } catch {
      // 忽略：保持退出流程可用
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
