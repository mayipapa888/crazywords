import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const MAX_NAME_LENGTH = 80;

async function findOwnedList(id: string, userId: string) {
  return prisma.wordList.findFirst({ where: { id, userId } });
}

/** PATCH /api/lists/{id} —— 重命名词库（校验归属，空名 400） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;

    const owned = await findOwnedList(id, auth.user.id);
    if (!owned) {
      return NextResponse.json({ error: "词库不存在" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }

    const rawName = (body as { name?: unknown } | null)?.name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "词库名不能为空" }, { status: 400 });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `词库名过长（最多 ${MAX_NAME_LENGTH} 个字符）` },
        { status: 400 },
      );
    }

    const list = await prisma.wordList.update({
      where: { id },
      data: { name },
      select: { id: true, name: true, source: true, createdAt: true },
    });
    return jsonWithSession({ list }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}

/** DELETE /api/lists/{id} —— 删除词库（词条 / 卡牌 / attempt 由外键级联删除） */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;

    const owned = await findOwnedList(id, auth.user.id);
    if (!owned) {
      return NextResponse.json({ error: "词库不存在" }, { status: 404 });
    }

    await prisma.wordList.delete({ where: { id } });
    return jsonWithSession({ ok: true }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
