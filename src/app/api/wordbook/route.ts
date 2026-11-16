import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 「我的单词本」= 用户接触过的所有单词，来源两处：
 *  1. dictation：Attempt 中该用户（Session.userId 关联）出现过的 entryId，取最近一次时间与累计次数；
 *  2. list：该用户所有 WordList 下的 WordEntry，取加入时间（WordEntry.createdAt）。
 *
 * 合并去重：听写流包含“听过”的词，词库流只取“没听过”的词（attempts none），
 * 两条流天然按 entryId 不重叠；再在归并时按“最近接触时间”倒序排列。
 * 这样既满足“同一单词两个来源都标记”，也不会重复计数。
 *
 * 分页：两个来源各自用 Prisma skip/take 取块（每块 pageSize 条），
 * 从两条有序流中一路归并到目标页窗口，只取该窗口的词条详情。
 * 不一次性把 Attempt / WordEntry 全表载入内存。
 */

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

type DictationRow = {
  entryId: string;
  lastStudiedAt: Date;
  studyCount: number;
};

type ListRow = {
  entryId: string;
  addedAt: Date;
};

type PickedRow = {
  entryId: string;
  lastStudiedAt: Date | null;
  studyCount: number;
};

type Source = "dictation" | "list";

function parsePositiveInt(raw: string | null, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 听写来源：按 entryId 聚合最近听写时间与累计次数，按最近时间倒序。 */
async function fetchDictationChunk(
  userId: string,
  q: string,
  skip: number,
  take: number,
): Promise<DictationRow[]> {
  const rows = await prisma.attempt.groupBy({
    by: ["entryId"],
    where: {
      session: { userId },
      ...(q
        ? { entry: { OR: [{ word: { contains: q } }, { glossZh: { contains: q } }] } }
        : {}),
    },
    _max: { createdAt: true },
    _count: { _all: true },
    orderBy: [{ _max: { createdAt: "desc" } }, { entryId: "asc" }],
    skip,
    take,
  });

  return rows.flatMap((row) =>
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
}

/** 词库来源：只取该用户词库中“没被听过”的词条，按加入时间倒序。 */
async function fetchListChunk(
  userId: string,
  q: string,
  skip: number,
  take: number,
): Promise<ListRow[]> {
  const rows = await prisma.wordEntry.findMany({
    where: {
      list: { userId },
      attempts: { none: { session: { userId } } },
      ...(q ? { OR: [{ word: { contains: q } }, { glossZh: { contains: q } }] } : {}),
    },
    select: { id: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
  });

  return rows.map((row) => ({ entryId: row.id, addedAt: row.createdAt }));
}

/**
 * 归并两条倒序流，取第 page 页窗口（服务端分页的核心）。
 * 听写流按 lastStudiedAt、词库流按 addedAt 排列，时间相同则听写优先。
 */
async function loadPageRows(
  userId: string,
  q: string,
  page: number,
  pageSize: number,
): Promise<PickedRow[]> {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  let dictation: DictationRow[] = [];
  let list: ListRow[] = [];
  let dictationSkip = 0;
  let listSkip = 0;
  let dictationDone = false;
  let listDone = false;

  const picked: PickedRow[] = [];
  let index = 0;

  while (index < end) {
    if (dictation.length === 0 && !dictationDone) {
      dictation = await fetchDictationChunk(userId, q, dictationSkip, pageSize);
      dictationSkip += dictation.length;
      if (dictation.length < pageSize) dictationDone = true;
    }
    if (list.length === 0 && !listDone) {
      list = await fetchListChunk(userId, q, listSkip, pageSize);
      listSkip += list.length;
      if (list.length < pageSize) listDone = true;
    }

    const nextDictation = dictation[0];
    const nextList = list[0];
    if (!nextDictation && !nextList) break;

    // 时间相同（或只剩听写）时优先听写，对应“听过的时间优先，其次加入时间”。
    const takeDictation =
      nextDictation !== undefined &&
      (nextList === undefined ||
        nextDictation.lastStudiedAt.getTime() >= nextList.addedAt.getTime());

    if (takeDictation) {
      const row = dictation.shift() as DictationRow;
      if (index >= start) {
        picked.push({
          entryId: row.entryId,
          lastStudiedAt: row.lastStudiedAt,
          studyCount: row.studyCount,
        });
      }
    } else {
      const row = list.shift() as ListRow;
      if (index >= start) {
        picked.push({ entryId: row.entryId, lastStudiedAt: null, studyCount: 0 });
      }
    }
    index += 1;
  }

  return picked;
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

    const searchWhere = q
      ? { OR: [{ word: { contains: q } }, { glossZh: { contains: q } }] }
      : {};

    // total 由两条互不重叠的来源相加：听写过的 + 词库里没听过的，即按 entryId 去重后的总数。
    const [dictationTotal, listTotal] = await Promise.all([
      prisma.wordEntry.count({
        where: {
          attempts: { some: { session: { userId } } },
          ...searchWhere,
        },
      }),
      prisma.wordEntry.count({
        where: {
          list: { userId },
          attempts: { none: { session: { userId } } },
          ...searchWhere,
        },
      }),
    ]);
    const total = dictationTotal + listTotal;

    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);

    const picked = await loadPageRows(userId, q, page, pageSize);

    const entries = picked.length
      ? await prisma.wordEntry.findMany({
          where: { id: { in: picked.map((row) => row.entryId) } },
          select: {
            id: true,
            word: true,
            ipa: true,
            glossZh: true,
            pos: true,
            example: true,
            createdAt: true,
            list: { select: { userId: true } },
          },
        })
      : [];
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));

    const items = picked.flatMap((row) => {
      const entry = entryById.get(row.entryId);
      if (!entry) return [];

      const sources: Source[] = [];
      if (row.lastStudiedAt) sources.push("dictation");
      if (entry.list.userId === userId) sources.push("list");

      return [
        {
          entryId: entry.id,
          word: entry.word,
          ipa: entry.ipa,
          glossZh: entry.glossZh,
          pos: entry.pos,
          example: entry.example,
          sources,
          studyCount: row.studyCount,
          lastStudiedAt: row.lastStudiedAt,
          addedAt: entry.createdAt,
        },
      ];
    });

    return jsonWithSession({ total, page, pageSize, items }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
