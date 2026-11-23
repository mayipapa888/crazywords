import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, isValidPassword } from "@/lib/password";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 24;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

type RegisterBody = {
  username?: unknown;
  password?: unknown;
};

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json().catch(() => null);
    const body: RegisterBody = raw && typeof raw === "object" ? (raw as RegisterBody) : {};

    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (
      username.length < USERNAME_MIN_LENGTH ||
      username.length > USERNAME_MAX_LENGTH ||
      !USERNAME_PATTERN.test(username)
    ) {
      return fail("用户名需为 3–24 位字母、数字、下划线或短横线", 400);
    }
    if (!isValidPassword(password)) {
      return fail("密码长度需为 8–64 位", 400);
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return fail("用户名已被占用", 409);
    }

    await prisma.user.create({
      data: {
        username,
        passwordHash: hashPassword(password),
        role: "user",
        status: "pending",
        // 占位会话键：注册阶段不登录，登录成功时会重新生成
        sessionKey: randomBytes(24).toString("hex"),
        locale: "zh-CN",
        dailyGoalDefault: 20,
        clozeEnabled: true,
      },
    });

    return NextResponse.json(
      { ok: true, message: "注册成功，等待管理员开通" },
      { status: 201 },
    );
  } catch (e) {
    // 并发注册时唯一索引兜底
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("用户名已被占用", 409);
    }
    return fail("注册失败，请稍后重试", 500);
  }
}
