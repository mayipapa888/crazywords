import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import {
  CHECKIN_BONUS,
  LISTENING_SECONDS_PER_POINT,
  NEW_WORD_BONUS,
  POINTS_PER_WORD,
  computePoints,
} from "@/lib/points";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const url = new URL(req.url);
    // 累计积分与每日明细统一由 computePoints 计算（与宠物页共用同一套公式）
    const summary = await computePoints(auth.user.id);
    const today = summary.today;
    const currentMonth = today.slice(0, 7);
    const rawMonth = url.searchParams.get("month");
    const month = rawMonth && MONTH_RE.test(rawMonth) ? rawMonth : currentMonth;

    const days: Record<
      string,
      { words: number; correct: number; points: number; newWords: number }
    > = {};
    let monthWords = 0;
    let monthDays = 0;
    let monthPoints = 0;

    for (const day of summary.days) {
      if (!day.date.startsWith(`${month}-`)) continue;

      days[day.date] = {
        words: day.words,
        correct: day.correct,
        points: day.points,
        newWords: day.newWords,
      };
      monthWords += day.words;
      monthDays += 1;
      monthPoints += day.points;
    }

    return jsonWithSession(
      {
        month,
        today,
        days,
        monthWords,
        monthDays,
        monthPoints,
        totalPoints: summary.totalPoints,
        streak: summary.streak,
        rules: {
          pointsPerWord: POINTS_PER_WORD,
          checkinBonus: CHECKIN_BONUS,
          newWordBonus: NEW_WORD_BONUS,
          listeningMinutesPerPoint: Math.round(LISTENING_SECONDS_PER_POINT / 60),
        },
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}
