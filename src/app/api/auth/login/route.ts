import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { withSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

const ACCESS_COOKIE = "cw_unlocked";
const ACCESS_MAX_AGE = 60 * 60 * 24 * 30;

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

function fail(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** 供 AppShell 的门禁提示读取：是否配置了实例级访问密码。 */
export async function GET() {
  return NextResponse.json({
    gated: Boolean(process.env.APP_ACCESS_PASSWORD?.trim()),
  });
}

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json().catch(() => null);
    const body: LoginBody = raw && typeof raw === "object" ? (raw as LoginBody) : {};
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const gate = process.env.APP_ACCESS_PASSWORD?.trim();

    // 兼容旧的实例门禁：SessionBootstrap 只提交 { password }。
    // 密码等于 APP_ACCESS_PASSWORD 时只发解锁 cookie，不建立账号会话。
    if (gate && password === gate && !username) {
      const res = NextResponse.json({ ok: true, gated: true });
      res.cookies.set(ACCESS_COOKIE, "1", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: ACCESS_MAX_AGE,
        secure: process.env.NODE_ENV === "production",
      });
      return res;
    }

    if (!username || !password) {
      return fail("用户名或密码错误", 401);
    }

    const user = await prisma.user.findUnique({ where: { username } });
    // 用户不存在、无密码（历史匿名账号）、密码错误统一返回同一提示
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return fail("用户名或密码错误", 401);
    }
    if (user.status === "pending") {
      return fail("账号待管理员开通", 403, { status: "pending" });
    }
    if (user.status === "disabled") {
      return fail("账号已被停用", 403, { status: "disabled" });
    }
    if (user.status !== "active") {
      return fail("账号不可用", 403, { status: user.status });
    }

    const sessionKey = randomBytes(24).toString("hex");
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { sessionKey },
    });

    const res = NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        username: updated.username,
        role: updated.role,
      },
    });
    withSessionCookie(res, sessionKey);

    // 开启实例门禁时，登录成功即视为通过门禁，避免再输一次访问密码
    if (gate) {
      res.cookies.set(ACCESS_COOKIE, "1", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: ACCESS_MAX_AGE,
        secure: process.env.NODE_ENV === "production",
      });
    }

    return res;
  } catch {
    return fail("登录失败，请稍后重试", 500);
  }
}
