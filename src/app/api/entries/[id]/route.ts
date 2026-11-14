import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray, toJsonArray } from "@/lib/json";

async function assertOwned(entryId: string, userId: string) {
  const entry = await prisma.wordEntry.findUnique({
    where: { id: entryId },
    include: { list: true },
  });
  if (!entry || entry.list.userId !== userId) return null;
  return entry;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;
    const entry = await assertOwned(id, auth.user.id);
    if (!entry) return errorJson(Object.assign(new Error("未找到"), { status: 404 }), 404);
    return jsonWithSession(
      {
        entry: {
          ...entry,
          phrases: parseStringArray(entry.phrases),
          related: parseStringArray(entry.related),
        },
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;
    const owned = await assertOwned(id, auth.user.id);
    if (!owned) return errorJson(Object.assign(new Error("未找到"), { status: 404 }), 404);
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.word != null) data.word = String(body.word).trim();
    if (body.glossZh !== undefined) data.glossZh = body.glossZh?.trim() || null;
    if (body.ipa !== undefined) data.ipa = body.ipa?.trim() || null;
    if (body.pos !== undefined) data.pos = body.pos?.trim() || null;
    if (body.example !== undefined) data.example = body.example?.trim() || null;
    if (Array.isArray(body.phrases)) data.phrases = toJsonArray(body.phrases);
    if (Array.isArray(body.related)) data.related = toJsonArray(body.related);

    try {
      const entry = await prisma.wordEntry.update({ where: { id }, data });
      return jsonWithSession(
        {
          entry: {
            ...entry,
            phrases: parseStringArray(entry.phrases),
            related: parseStringArray(entry.related),
          },
        },
        auth,
      );
    } catch {
      return errorJson(Object.assign(new Error("更新失败（可能单词重复）"), { status: 400 }), 400);
    }
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;
    const owned = await assertOwned(id, auth.user.id);
    if (!owned) return errorJson(Object.assign(new Error("未找到"), { status: 404 }), 404);
    await prisma.wordEntry.delete({ where: { id } });
    return jsonWithSession({ ok: true }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
