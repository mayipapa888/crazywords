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

/**
 * 基础 HTML 安全校验：拒绝 <script / <iframe / 标签内 on*= 事件属性。
 * 真正的白名单过滤在浏览器端 src/lib/notes/sanitize.ts 完成。
 */
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

/**
 * Prisma Client 由 `prisma generate` 生成；schema 已包含 KnowledgeNote，
 * 因此直接使用 prisma.knowledgeNote（生成物缺失时 tsc 会立刻报错）。
 */
const notesDb = prisma;

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const notes = await notesDb.knowledgeNote.findMany({
      where: { userId: auth.user.id },
      orderBy: { updatedAt: "desc" },
    });
    return jsonWithSession({ notes: notes.map(toPayload) }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const raw: unknown = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

    const rawTitle = body.title;
    if (rawTitle !== undefined && typeof rawTitle !== "string") {
      return errorJson(Object.assign(new Error("标题格式不正确"), { status: 400 }), 400);
    }
    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";

    const content = body.content;
    if (typeof content !== "string" || !content.trim()) {
      return errorJson(Object.assign(new Error("内容不能为空"), { status: 400 }), 400);
    }

    let contentHtml: string | null = null;
    if (body.contentHtml !== undefined) {
      const parsed = parseContentHtml(body.contentHtml);
      if (!parsed.ok) {
        return errorJson(Object.assign(new Error(parsed.error), { status: 400 }), 400);
      }
      contentHtml = parsed.value;
    }

    const note = await notesDb.knowledgeNote.create({
      data: {
        userId: auth.user.id,
        title: title || "未命名",
        content,
        contentHtml,
      },
    });
    return jsonWithSession({ note: toPayload(note) }, auth, { status: 201 });
  } catch (e) {
    return errorJson(e, 400);
  }
}
