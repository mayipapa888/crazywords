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

    const note = await notesDb.knowledgeNote.create({
      data: {
        userId: auth.user.id,
        title: title || "未命名",
        content,
      },
    });
    return jsonWithSession({ note: toPayload(note) }, auth, { status: 201 });
  } catch (e) {
    return errorJson(e, 400);
  }
}
