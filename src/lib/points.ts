/**
 * 学习积分的唯一计算口径（累计积分，不做扣减）。
 *
 * 打卡页 `/api/stats/calendar` 与宠物页 `/api/pet` 都调用这里的 computePoints，
 * 保证「积分公式」只有一份：不重复单词 ×10 + 打卡 20 + 首次新词 ×5 + 磨耳朵每 5 分钟 1。
 * 消耗（PointSpend）不在这里扣，由调用方按「累计 − 已消耗」自行计算。
 */

import { prisma } from "@/lib/db";

/** 每个不重复单词的积分 */
export const POINTS_PER_WORD = 5;
/** 当天有打卡（至少 1 个 attempt）的额外积分 */
export const CHECKIN_BONUS = 5;
/** 首次学到一个新词（该词历史第一次出现）的额外积分 */
export const NEW_WORD_BONUS = 0;
/** 磨耳朵多少秒计 1 分 */
export const LISTENING_SECONDS_PER_POINT = 60;

const TZ = "Asia/Shanghai";

type DatePart = "year" | "month" | "day";

const dayKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 按 Asia/Shanghai 本地日生成 YYYY-MM-DD 键，与服务器进程时区无关。 */
export function dayKey(date: Date): string {
  const parts = dayKeyFormatter.formatToParts(date);
  const pick = (type: DatePart) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** 在 YYYY-MM-DD 键上按自然日偏移，避免时区换算导致跨天错误。 */
export function shiftDayKey(key: string, delta: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 单日积分明细（只包含有听写记录的日子） */
export type PointDay = {
  date: string;
  words: number;
  correct: number;
  newWords: number;
  points: number;
};

export type PointsSummary = {
  /** 今天（Asia/Shanghai）的 YYYY-MM-DD */
  today: string;
  /** 历史累计积分（不含消耗） */
  totalPoints: number;
  /** 按日期升序的每日明细 */
  days: PointDay[];
  /** 连续打卡天数 */
  streak: number;
};

/**
 * 汇总某个用户的累计积分与每日明细。
 * 单用户数据量小，全部历史一次读出后在内存中按自然日聚合。
 */
/** Asia/Shanghai 当天 0 点对应的 UTC 时刻（无夏令时，固定 +8） */
export function shanghaiDayStart(now: Date = new Date()): Date {
  const [year, month, day] = dayKey(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 8 * 3600_000);
}

/**
 * @param since 只统计该时刻（含）之后的积分；用于「积分从某天开始重新计算」的场景。
 *              新词判定仍基于全量历史，避免把复习词误判成新词。
 */
export async function computePoints(
  userId: string,
  now: Date = new Date(),
  since?: Date,
): Promise<PointsSummary> {
  const [attempts, listeningLogs] = await Promise.all([
    prisma.attempt.findMany({
      where: { session: { userId } },
      select: { entryId: true, overallOk: true, createdAt: true },
    }),
    prisma.listeningLog.findMany({
      where: { userId },
      select: { date: true, seconds: true },
    }),
  ]);

  const listeningByDay = new Map<string, number>();
  for (const log of listeningLogs) listeningByDay.set(log.date, log.seconds);

  type DayAgg = { entries: Set<string>; correct: Set<string> };
  const byDay = new Map<string, DayAgg>();
  /** 每个词历史最早一次听写所在日，用于判定「首次学新词」 */
  const firstSeenDay = new Map<string, string>();

  for (const attempt of attempts) {
    const key = dayKey(attempt.createdAt);
    let agg = byDay.get(key);
    if (!agg) {
      agg = { entries: new Set<string>(), correct: new Set<string>() };
      byDay.set(key, agg);
    }
    agg.entries.add(attempt.entryId);
    if (attempt.overallOk) agg.correct.add(attempt.entryId);

    const first = firstSeenDay.get(attempt.entryId);
    if (!first || key < first) firstSeenDay.set(attempt.entryId, key);
  }

  // 每天的新词数量
  const newWordsByDay = new Map<string, number>();
  for (const day of firstSeenDay.values()) {
    newWordsByDay.set(day, (newWordsByDay.get(day) ?? 0) + 1);
  }

  const days: PointDay[] = [];
  let totalPoints = 0;

  const sinceKey = since ? dayKey(since) : null;

  for (const date of [...byDay.keys()].sort()) {
    const agg = byDay.get(date);
    if (!agg) continue;
    // 只统计 since 当天及之后的日子
    if (sinceKey && date < sinceKey) continue;

    const words = agg.entries.size;
    const newWords = newWordsByDay.get(date) ?? 0;
    const listeningPoints = Math.floor(
      (listeningByDay.get(date) ?? 0) / LISTENING_SECONDS_PER_POINT,
    );
    const points =
      words * POINTS_PER_WORD + CHECKIN_BONUS + newWords * NEW_WORD_BONUS + listeningPoints;
    totalPoints += points;
    days.push({ date, words, correct: agg.correct.size, newWords, points });
  }

  // 连续打卡：从今天（今天没打卡则从昨天）向前数连续有 attempt 的日子。
  const today = dayKey(now);
  const yesterday = shiftDayKey(today, -1);
  let cursor: string | null = byDay.has(today)
    ? today
    : byDay.has(yesterday)
      ? yesterday
      : null;
  let streak = 0;
  while (cursor && byDay.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  return { today, totalPoints, days, streak };
}
