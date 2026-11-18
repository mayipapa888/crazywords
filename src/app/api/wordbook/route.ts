import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 「我的单词本」只收录用户真正听写过的单词：
 * Attempt 通过 Session.userId 归属用户，按 entryId 聚合出 studyCount 与 lastStudiedAt。
 * 词库（WordList / WordEntry）只提供词条元数据，不再决定“是否收录”；
 * 因此没有 attempt 的导入词条不会出现在列表里。
 *
 * 分页全部在服务端：groupBy 直接按 _max.createdAt 倒序 + skip/take 取当前页的 entryId，
 * 再按 id 批量取词条字段，不把 Attempt 全表载入内存。
 * total 用 WordEntry.count 统计“该用户至少听过一次的词条数”，与 groupBy 的
 * distinct entryId 集合一致，所以 total 就是背过的单词数。
 */

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

type AggregatedRow = {
  entryId: string;
  lastStudiedAt: Date;
  studyCount: number;
};

function parsePositiveInt(raw: string | null, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const userId = auth.user.id;
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") ?? "").trim();
    const pageSize = Math.min(
      parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const requestedPage = parsePositiveInt(searchParams.get("page"), 1);

    const entrySearch = q
      ? { OR: [{ word: { contains: q } }, { glossZh: { contains: q } }] }
      : {};

    // 背过的单词数 = 当前用户 attempt 涉及的 distinct entryId 数。
    const total = await prisma.wordEntry.count({
      where: {
        attempts: { some: { session: { userId } } },
        ...entrySearch,
      },
    });

    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const skip = (page - 1) * pageSize;

    const grouped = await prisma.attempt.groupBy({
      by: ["entryId"],
      where: {
        session: { userId },
        ...(q ? { entry: entrySearch } : {}),
      },
      _max: { createdAt: true },
      _count: { _all: true },
      orderBy: [{ _max: { createdAt: "desc" } }, { entryId: "asc" }],
      skip,
      take: pageSize,
    });

    // groupBy 的 _max 在类型上可空；存在 attempt 的组一定有值，这里仅为类型收窄。
    const rows: AggregatedRow[] = grouped.flatMap((row) =>
      row._max.createdAt
        ? [
            {
              entryId: row.entryId,
              lastStudiedAt: row._max.createdAt,
              studyCount: row._count._all,
            },
          ]
        : [],
    );

    const entries = rows.length
      ? await prisma.wordEntry.findMany({
          where: { id: { in: rows.map((row) => row.entryId) } },
          select: {
            id: true,
            word: true,
            ipa: true,
            glossZh: true,
            pos: true,
            example: true,
          },
        })
      : [];
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));

    // 按 groupBy 的顺序（lastStudiedAt 倒序）输出。
    const items = rows.flatMap((row) => {
      const entry = entryById.get(row.entryId);
      if (!entry) return [];
      return [
        {
          entryId: entry.id,
          word: entry.word,
          ipa: entry.ipa,
          glossZh: entry.glossZh,
          pos: entry.pos,
          example: entry.example,
          studyCount: row.studyCount,
          lastStudiedAt: row.lastStudiedAt,
        },
      ];
    });

    return jsonWithSession({ total, page, pageSize, items }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
