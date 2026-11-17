import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type NoteRecord = {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

function toPayload(note: NoteRecord) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** 同 ../route.ts：schema 已包含 KnowledgeNote，直接使用 prisma.knowledgeNote。 */
const notesDb = prisma;

async function findOwned(id: string, userId: string) {
  return notesDb.knowledgeNote.findFirst({ where: { id, userId } });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;
    const owned = await findOwned(id, auth.user.id);
    if (!owned) {
      return errorJson(Object.assign(new Error("未找到该知识点"), { status: 404 }), 404);
    }

    const raw: unknown = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const data: { title?: string; content?: string } = {};

    const nextTitle = body.title;
    if (nextTitle !== undefined) {
      if (typeof nextTitle !== "string") {
        return errorJson(Object.assign(new Error("标题格式不正确"), { status: 400 }), 400);
      }
      data.title = nextTitle.trim() || "未命名";
    }

    const nextContent = body.content;
    if (nextContent !== undefined) {
      if (typeof nextContent !== "string" || !nextContent.trim()) {
        return errorJson(Object.assign(new Error("内容不能为空"), { status: 400 }), 400);
      }
      data.content = nextContent;
    }

    if (Object.keys(data).length === 0) {
      return errorJson(Object.assign(new Error("没有需要更新的字段"), { status: 400 }), 400);
    }

    const note = await notesDb.knowledgeNote.update({ where: { id: owned.id }, data });
    return jsonWithSession({ note: toPayload(note) }, auth);
  } catch (e) {
    return errorJson(e, 400);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;
    const owned = await findOwned(id, auth.user.id);
    if (!owned) {
      return errorJson(Object.assign(new Error("未找到该知识点"), { status: 404 }), 404);
    }

    await notesDb.knowledgeNote.delete({ where: { id: owned.id } });
    return jsonWithSession({ ok: true }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
