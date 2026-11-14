import { prisma } from "../db";
import { canDictate } from "../json";
import { localDateKey } from "./schedule";

export type QueueItem = {
  entryId: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  mode: "gloss" | "cloze";
  reason: "due" | "wrong" | "new";
};

/**
 * 今日队列：到期复习 → 活跃错词（≤40% N）→ 新词补齐 N。
 * 逾期 ≥ N → 复习日，不抽新词。
 */
export async function buildTodayQueue(userId: string, goalN: number, clozeEnabled: boolean) {
  const now = new Date();
  const date = localDateKey(now);

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
  const dictatable = entries.filter((e) => canDictate(e, clozeEnabled));
  const byId = new Map(dictatable.map((e) => [e.id, e]));

  const cards = await prisma.cardState.findMany({ where: { userId } });
  const cardByEntry = new Map(cards.map((c) => [c.entryId, c]));

  const wrongs = await prisma.wrongBookItem.findMany({
    where: { userId, active: true },
    orderBy: { lastWrongAt: "desc" },
  });

  const pickMode = (entry: (typeof dictatable)[0]): "gloss" | "cloze" => {
    if (entry.glossZh?.trim()) return "gloss";
    return "cloze";
  };

  const due: QueueItem[] = [];
  for (const entry of dictatable) {
    const card = cardByEntry.get(entry.id);
    if (!card) continue;
    if (card.status === "suspended") continue;
    if (card.dueAt && card.dueAt <= now && card.status !== "new") {
      due.push({
        entryId: entry.id,
        word: entry.word,
        glossZh: entry.glossZh,
        ipa: entry.ipa,
        pos: entry.pos,
        example: entry.example,
        mode: pickMode(entry),
        reason: "due",
      });
    }
  }

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
        mode: pickMode(entry),
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
        mode: pickMode(entry),
        reason: "new",
      });
      used.add(entry.id);
    }
  }

  return { date, goalN, items: selected, reviewDay };
}
