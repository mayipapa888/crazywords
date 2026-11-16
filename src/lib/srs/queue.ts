import type { WordEntry } from "@prisma/client";
import { prisma } from "../db";
import { canDictate } from "../json";
import { localDateKey } from "./schedule";

export type DictationMode = "gloss" | "meaning";

export type QueueItem = {
  entryId: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  mode: DictationMode;
  reason: "due" | "wrong" | "new";
};

export type QueueBuild = {
  date: string;
  goalN: number;
  items: QueueItem[];
  reviewDay: boolean;
  tomorrowDueCount: number;
};

/** 模式奇偶交替：模式 B 关闭时只用模式 A；开启时 gloss/meaning 交替。 */
function createModePicker(meaningEnabled: boolean): () => DictationMode {
  let modeCursor = 0;
  return () => {
    if (!meaningEnabled) return "gloss";
    const mode: DictationMode = modeCursor % 2 === 0 ? "gloss" : "meaning";
    modeCursor += 1;
    return mode;
  };
}

function toQueueItem(
  entry: Pick<WordEntry, "id" | "word" | "glossZh" | "ipa" | "pos" | "example">,
  mode: DictationMode,
  reason: QueueItem["reason"],
): QueueItem {
  return {
    entryId: entry.id,
    word: entry.word,
    glossZh: entry.glossZh,
    ipa: entry.ipa,
    pos: entry.pos,
    example: entry.example,
    mode,
    reason,
  };
}

function emptyBuild(date: string, goalN: number): QueueBuild {
  return { date, goalN, items: [], reviewDay: false, tomorrowDueCount: 0 };
}

/**
 * 今日队列：到期复习 → 活跃错词（≤40% N）→ 新词补齐 N。
 * 逾期 ≥ N → 复习日，不抽新词。
 * clozeEnabled：沿用设置字段，表示是否启用模式 B（报单词 → 说中文）。
 */
export async function buildTodayQueue(
  userId: string,
  goalN: number,
  clozeEnabled: boolean,
): Promise<QueueBuild> {
  const now = new Date();
  const date = localDateKey(now);
  const meaningEnabled = clozeEnabled;

  const userLists = await prisma.wordList.findMany({
    where: { userId },
    select: { id: true },
  });
  const listIds = userLists.map((l) => l.id);
  if (listIds.length === 0) {
    return emptyBuild(date, goalN);
  }

  const entries = await prisma.wordEntry.findMany({
    where: { listId: { in: listIds } },
  });
  const dictatable = entries.filter((e) => canDictate(e, meaningEnabled));
  const byId = new Map(dictatable.map((e) => [e.id, e]));

  const cards = await prisma.cardState.findMany({ where: { userId } });
  const cardByEntry = new Map(cards.map((c) => [c.entryId, c]));

  const wrongs = await prisma.wrongBookItem.findMany({
    where: { userId, active: true },
    orderBy: { lastWrongAt: "desc" },
  });

  const pickMode = createModePicker(meaningEnabled);

  // 到期复习：dueAt <= now 的卡片，按 dueAt 升序（逾期最久的先复习）。
  const dueCandidates: { entry: (typeof dictatable)[number]; dueAt: Date }[] = [];
  for (const entry of dictatable) {
    const card = cardByEntry.get(entry.id);
    if (!card) continue;
    if (card.status === "suspended") continue;
    if (!card.dueAt || card.status === "new") continue;
    if (card.dueAt.getTime() > now.getTime()) continue;
    dueCandidates.push({ entry, dueAt: card.dueAt });
  }
  dueCandidates.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const due: QueueItem[] = dueCandidates.map(({ entry }) =>
    toQueueItem(entry, pickMode(), "due"),
  );

  const selected: QueueItem[] = [];
  const used = new Set<string>();

  for (const item of due) {
    if (selected.length >= goalN) break;
    selected.push(item);
    used.add(item.entryId);
  }

  const reviewDay = due.length >= goalN;
  const wrongCap = Math.floor(goalN * 0.4);

  if (!reviewDay) {
    let wrongAdded = 0;
    for (const w of wrongs) {
      if (selected.length >= goalN || wrongAdded >= wrongCap) break;
      if (used.has(w.entryId)) continue;
      const entry = byId.get(w.entryId);
      if (!entry) continue;
      selected.push(toQueueItem(entry, pickMode(), "wrong"));
      used.add(entry.id);
      wrongAdded += 1;
    }

    const news = dictatable.filter((e) => {
      if (used.has(e.id)) return false;
      const card = cardByEntry.get(e.id);
      return !card || card.status === "new";
    });

    for (const entry of news) {
      if (selected.length >= goalN) break;
      selected.push(toQueueItem(entry, pickMode(), "new"));
      used.add(entry.id);
    }
  }

  // 明日复习量：dueAt 落在明天本地日期区间内的卡片数，仅用于首页提示。
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const dayAfterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  let tomorrowDueCount = 0;
  for (const card of cards) {
    if (!card.dueAt || card.status === "new" || card.status === "suspended") continue;
    if (!byId.has(card.entryId)) continue;
    const dueTime = card.dueAt.getTime();
    if (dueTime >= tomorrowStart.getTime() && dueTime < dayAfterStart.getTime()) {
      tomorrowDueCount += 1;
    }
  }

  return { date, goalN, items: selected, reviewDay, tomorrowDueCount };
}

/**
 * 随机队列：从该用户全部词表中筛出可听写的词，随机取最多 n 个（reason = "new"）。
 * 用于「随机 20 个」这种不按 SRS 排程的练习。
 */
export async function buildRandomQueue(
  userId: string,
  n = 20,
  clozeEnabled: boolean,
): Promise<QueueBuild> {
  const date = localDateKey(new Date());
  const limit = Math.max(0, Math.floor(n));
  if (limit === 0) return emptyBuild(date, limit);

  const userLists = await prisma.wordList.findMany({
    where: { userId },
    select: { id: true },
  });
  const listIds = userLists.map((l) => l.id);
  if (listIds.length === 0) return emptyBuild(date, limit);

  const entries = await prisma.wordEntry.findMany({
    where: { listId: { in: listIds } },
  });
  const dictatable = entries.filter((e) => canDictate(e, clozeEnabled));

  // Fisher–Yates 洗牌，避免依赖数据库随机排序（SQLite / Postgres 语法不同）。
  for (let i = dictatable.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = dictatable[i];
    dictatable[i] = dictatable[j];
    dictatable[j] = tmp;
  }

  const pickMode = createModePicker(clozeEnabled);
  const items = dictatable
    .slice(0, limit)
    .map((entry) => toQueueItem(entry, pickMode(), "new"));

  return { date, goalN: limit, items, reviewDay: false, tomorrowDueCount: 0 };
}

/**
 * 错词本队列：取 active = true 的错词，按 lastWrongAt 倒序，最多 n 个（reason = "wrong"）。
 * 仍需 canDictate 过滤：无中文释义的词无法听写。
 */
export async function buildWrongQueue(
  userId: string,
  n = 20,
  clozeEnabled: boolean,
): Promise<QueueBuild> {
  const date = localDateKey(new Date());
  const limit = Math.max(0, Math.floor(n));
  if (limit === 0) return emptyBuild(date, limit);

  const userLists = await prisma.wordList.findMany({
    where: { userId },
    select: { id: true },
  });
  const listIds = new Set(userLists.map((l) => l.id));
  if (listIds.size === 0) return emptyBuild(date, limit);

  const wrongs = await prisma.wrongBookItem.findMany({
    where: { userId, active: true },
    orderBy: { lastWrongAt: "desc" },
    include: { entry: true },
  });

  const dictatable = wrongs.filter(
    (w) => listIds.has(w.entry.listId) && canDictate(w.entry, clozeEnabled),
  );

  const pickMode = createModePicker(clozeEnabled);
  const items = dictatable
    .slice(0, limit)
    .map((w) => toQueueItem(w.entry, pickMode(), "wrong"));

  return { date, goalN: limit, items, reviewDay: false, tomorrowDueCount: 0 };
}
