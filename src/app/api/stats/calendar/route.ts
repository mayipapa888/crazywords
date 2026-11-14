import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** 每个不重复单词的积分 */
const POINTS_PER_WORD = 10;
/** 当天有打卡（至少 1 个 attempt）的额外积分 */
const CHECKIN_BONUS = 20;

const TZ = "Asia/Shanghai";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type DatePart = "year" | "month" | "day";

const dayKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 按 Asia/Shanghai 本地日生成 YYYY-MM-DD 键，与服务器进程时区无关。 */
function dayKey(date: Date): string {
  const parts = dayKeyFormatter.formatToParts(date);
  const pick = (type: DatePart) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** 在 YYYY-MM-DD 键上按自然日偏移，避免时区换算导致跨天错误。 */
function shiftDayKey(key: string, delta: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const url = new URL(req.url);
    const today = dayKey(new Date());
    const currentMonth = today.slice(0, 7);
    const rawMonth = url.searchParams.get("month");
    const month = rawMonth && MONTH_RE.test(rawMonth) ? rawMonth : currentMonth;

    // 汇总累计积分与连续天数需要全部历史；单用户逐日聚合在内存中完成。
    const attempts = await prisma.attempt.findMany({
      where: { session: { userId: auth.user.id } },
      select: { entryId: true, overallOk: true, createdAt: true },
    });

    type DayAgg = { entries: Set<string>; correct: Set<string> };
    const byDay = new Map<string, DayAgg>();

    for (const attempt of attempts) {
      const key = dayKey(attempt.createdAt);
      let agg = byDay.get(key);
      if (!agg) {
        agg = { entries: new Set<string>(), correct: new Set<string>() };
        byDay.set(key, agg);
      }
      agg.entries.add(attempt.entryId);
      if (attempt.overallOk) agg.correct.add(attempt.entryId);
    }

    const days: Record<string, { words: number; correct: number; points: number }> = {};
    let monthWords = 0;
    let monthDays = 0;
    let monthPoints = 0;
    let totalPoints = 0;

    for (const key of [...byDay.keys()].sort()) {
      const agg = byDay.get(key);
      if (!agg) continue;

      const words = agg.entries.size;
      const points = words * POINTS_PER_WORD + CHECKIN_BONUS;
      totalPoints += points;

      if (!key.startsWith(`${month}-`)) continue;

      days[key] = { words, correct: agg.correct.size, points };
      monthWords += words;
      monthDays += 1;
      monthPoints += points;
    }

    // 连续打卡：从今天（今天没打卡则从昨天）向前数连续有 attempt 的日子。
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

    return jsonWithSession(
      {
        month,
        today,
        days,
        monthWords,
        monthDays,
        monthPoints,
        totalPoints,
        streak,
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}
