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

/**
 * 今日队列：到期复习 → 活跃错词（≤40% N）→ 新词补齐 N。
 * 逾期 ≥ N → 复习日，不抽新词。
 * clozeEnabled：沿用设置字段，表示是否启用模式 B（报单词 → 说中文）。
 */
export async function buildTodayQueue(userId: string, goalN: number, clozeEnabled: boolean) {
  const now = new Date();
  const date = localDateKey(now);
  const meaningEnabled = clozeEnabled;

  const userLists = await prisma.wordList.findMany({
    where: { userId },
    select: { id: true },
  });
  const listIds = userLists.map((l) => l.id);
  if (listIds.length === 0) {
    return { date, goalN, items: [] as QueueItem[], reviewDay: false };
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

  let modeCursor = 0;
  const pickMode = (): DictationMode => {
    if (!meaningEnabled) return "gloss";
    const mode: DictationMode = modeCursor % 2 === 0 ? "gloss" : "meaning";
    modeCursor += 1;
    return mode;
  };

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
  const due: QueueItem[] = dueCandidates.map(({ entry }) => ({
    entryId: entry.id,
    word: entry.word,
    glossZh: entry.glossZh,
    ipa: entry.ipa,
    pos: entry.pos,
    example: entry.example,
    mode: pickMode(),
    reason: "due",
  }));

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
      selected.push({
        entryId: entry.id,
        word: entry.word,
        glossZh: entry.glossZh,
        ipa: entry.ipa,
        pos: entry.pos,
        example: entry.example,
        mode: pickMode(),
        reason: "wrong",
      });
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
      selected.push({
        entryId: entry.id,
        word: entry.word,
        glossZh: entry.glossZh,
        ipa: entry.ipa,
        pos: entry.pos,
        example: entry.example,
        mode: pickMode(),
        reason: "new",
      });
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
