import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/lists
 * 返回当前用户所有词库 + 统计：
 * - total：该词库的词条总数
 * - studied：该用户在词库中「有 attempt 记录」的词条数（按 entryId 去重）
 *
 * 统计分三步，全部为集合查询，不对每个词库单独发请求（无 N+1）：
 * 1) wordList.findMany 取词库与 _count；
 * 2) wordEntry.findMany 取 (entryId -> listId) 映射；
 * 3) attempt.groupBy(["entryId"]) 一次取出该用户背过的去重词条，再按映射归到词库。
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);

    const lists = await prisma.wordList.findMany({
      where: { userId: auth.user.id },
      select: {
        id: true,
        name: true,
        source: true,
        createdAt: true,
        _count: { select: { entries: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const entryRows = await prisma.wordEntry.findMany({
      where: { list: { userId: auth.user.id } },
      select: { id: true, listId: true },
    });

    const studiedRows =
      entryRows.length === 0
        ? []
        : await prisma.attempt.groupBy({
            by: ["entryId"],
            where: { entryId: { in: entryRows.map((e) => e.id) } },
          });

    const listIdByEntry = new Map(entryRows.map((e) => [e.id, e.listId]));
    const studiedByList = new Map<string, number>();
    for (const row of studiedRows) {
      const listId = listIdByEntry.get(row.entryId);
      if (!listId) continue;
      studiedByList.set(listId, (studiedByList.get(listId) ?? 0) + 1);
    }

    return jsonWithSession(
      {
        lists: lists.map((list) => ({
          id: list.id,
          name: list.name,
          source: list.source,
          createdAt: list.createdAt,
          total: list._count.entries,
          studied: studiedByList.get(list.id) ?? 0,
        })),
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json();
    const name = String(body.name || "默认词表").trim() || "默认词表";
    const list = await prisma.wordList.create({
      data: { userId: auth.user.id, name, source: body.source || "manual" },
    });
    return jsonWithSession({ list }, auth, { status: 201 });
  } catch (e) {
    return errorJson(e, 401);
  }
}
