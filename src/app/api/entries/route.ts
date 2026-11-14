import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { entryCompleteness, parseStringArray } from "@/lib/json";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim().toLowerCase();
    const listId = searchParams.get("listId");

    const lists = await prisma.wordList.findMany({
      where: { userId: auth.user.id, ...(listId ? { id: listId } : {}) },
      select: { id: true },
    });
    const listIds = lists.map((l) => l.id);

    const entries = await prisma.wordEntry.findMany({
      where: {
        listId: { in: listIds },
        ...(q
          ? {
              OR: [{ word: { contains: q } }, { glossZh: { contains: q } }],
            }
          : {}),
      },
      orderBy: { word: "asc" },
    });

    const payload = entries.map((e) => {
      const { incomplete, reasons } = entryCompleteness(e);
      return {
        ...e,
        phrases: parseStringArray(e.phrases),
        related: parseStringArray(e.related),
        incomplete,
        incompleteReasons: reasons,
      };
    });

    return jsonWithSession({ entries: payload }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
