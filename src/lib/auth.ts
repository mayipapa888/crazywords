import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "./db";

export const SESSION_COOKIE = "cw_sid";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days
const ACCESS_COOKIE = "cw_unlocked";

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

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export type AuthResult = {
  user: User;
  /** 新会话时需写入响应（当前账号体系下登录接口自行写 cookie，保留字段兼容旧调用） */
  newSessionKey?: string;
};

/** 判断库里的用户是否是可登录的正式账号。 */
function isActiveAccount(user: User | null): user is User {
  return Boolean(user && user.status === "active" && user.username);
}

/**
 * 按 httpOnly 会话 cookie 取当前登录用户。
 * - 只认 status=active 且已设置 username 的账号，不再自动创建匿名用户；
 * - 未登录 / 待审核 / 停用 / 会话失效一律抛 401「请先登录」。
 * - 可选 APP_ACCESS_PASSWORD：设置后仍须 cw_unlocked=1 才能访问。
 */
export async function requireUser(req: Request): Promise<AuthResult> {
  const jar = parseCookieHeader(req.headers.get("cookie"));
  const gate = process.env.APP_ACCESS_PASSWORD?.trim();
  if (gate && jar[ACCESS_COOKIE] !== "1") {
    throw httpError("请先登录", 401);
  }

  const sid = jar[SESSION_COOKIE];
  if (sid) {
    const user = await prisma.user.findUnique({ where: { sessionKey: sid } });
    if (isActiveAccount(user)) return { user };
  }

  throw httpError("请先登录", 401);
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

/** Server Component / 页面侧读取当前用户；未登录直接跳 /login，不创建用户。 */
export async function getPageUser(): Promise<User> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) {
    const user = await prisma.user.findUnique({ where: { sessionKey: sid } });
    if (isActiveAccount(user)) return user;
  }
  redirect("/login");
}
