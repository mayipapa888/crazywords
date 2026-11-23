import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { errorJson, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const ACTIONS = ["approve", "disable", "enable", "delete"] as const;
type AdminAction = (typeof ACTIONS)[number];

type ActionBody = { action?: unknown };

const USER_SELECT = {
  id: true,
  username: true,
  status: true,
  role: true,
  createdAt: true,
} as const;

function isAction(value: unknown): value is AdminAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireUser(req);
    if (auth.user.role !== "admin") {
      return fail("仅管理员可访问", 403);
    }

    const { id } = await context.params;
    const raw: unknown = await req.json().catch(() => null);
    const body: ActionBody = raw && typeof raw === "object" ? (raw as ActionBody) : {};
    const action = body.action;

    if (!isAction(action)) {
      return fail("action 必须是 approve、disable、enable 或 delete", 400);
    }

    if (id === auth.user.id && (action === "disable" || action === "delete")) {
      return fail("不能停用或删除自己的账号", 400);
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return fail("用户不存在", 404);
    }

    if (action === "delete") {
      await prisma.user.delete({ where: { id } });
      return NextResponse.json({ ok: true, deleted: true });
    }

    if (!target.username) {
      return fail("该用户不是注册账号，无法变更状态", 400);
    }

    // disable 同时清空 sessionKey，使其现有 cookie 立即失效
    const updated = await prisma.user.update({
      where: { id },
      data:
        action === "disable"
          ? { status: "disabled", sessionKey: null }
          : { status: "active" },
      select: USER_SELECT,
    });

    return NextResponse.json({ ok: true, user: updated });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return fail("用户不存在", 404);
    }
    return errorJson(e, 500);
  }
}
