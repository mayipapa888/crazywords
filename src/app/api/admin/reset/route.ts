import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type ResetRequestBody = { password: string };

function readPassword(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const { password } = body as Partial<ResetRequestBody>;
  return typeof password === "string" ? password : "";
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body: unknown = await req.json().catch(() => null);
    const expected = process.env.ADMIN_RESET_PASSWORD?.trim() || "620603";
    if (readPassword(body) !== expected) {
      return errorJson(Object.assign(new Error("管理密码错误"), { status: 403 }), 403);
    }

    const userId = auth.user.id;
    // 先删卡片/错词/会话，再删词表；词表删除时 WordEntry 级联清理。
    const [cards, wrongs, sessions, lists] = await prisma.$transaction([
      prisma.cardState.deleteMany({ where: { userId } }),
      prisma.wrongBookItem.deleteMany({ where: { userId } }),
      prisma.session.deleteMany({ where: { userId } }),
      prisma.wordList.deleteMany({ where: { userId } }),
    ]);

    return jsonWithSession(
      {
        ok: true,
        deleted: {
          lists: lists.count,
          cards: cards.count,
          wrongs: wrongs.count,
          sessions: sessions.count,
        },
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}
