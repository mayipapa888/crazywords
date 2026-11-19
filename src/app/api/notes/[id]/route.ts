import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type NoteRecord = {
  id: string;
  userId: string;
  title: string;
  content: string;
  contentHtml: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const HTML_MAX_LENGTH = 20000;

/** 与 ../route.ts 保持一致：拒绝 <script / <iframe / 标签内 on*= 事件属性。 */
const UNSAFE_HTML_PATTERN =
  /<\s*\/?\s*(?:script|iframe)|<\s*[a-z][^>]*(?:\s|\/)on[a-z]+\s*=/i;

function parseContentHtml(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "富文本格式不正确" };
  if (raw.length > HTML_MAX_LENGTH) {
    return { ok: false, error: "富文本内容过长（最多 20000 字符）" };
  }
  if (UNSAFE_HTML_PATTERN.test(raw)) {
    return { ok: false, error: "富文本包含不安全的标签或属性" };
  }
  return { ok: true, value: raw.trim() ? raw : null };
}

function toPayload(note: NoteRecord) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    contentHtml: note.contentHtml,
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
    const data: { title?: string; content?: string; contentHtml?: string | null } = {};

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

    if (body.contentHtml !== undefined) {
      const parsed = parseContentHtml(body.contentHtml);
      if (!parsed.ok) {
        return errorJson(Object.assign(new Error(parsed.error), { status: 400 }), 400);
      }
      data.contentHtml = parsed.value;
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
