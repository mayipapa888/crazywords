import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 磨耳朵收听时长的日期键统一使用 Asia/Shanghai 本地日，
 * 与 /api/stats/calendar 的 day key 完全一致，避免打卡页跨天对不上。
 */
const TZ = "Asia/Shanghai";
/** GET 返回最近 35 天（含今天），供打卡页合并展示 */
const MAX_DAYS = 35;
/** 单次上报上限：前端每 30 秒上报一次，600 秒足够容纳离线补报且防刷 */
const MAX_STEP_SECONDS = 600;

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

function badRequest(message: string) {
  return errorJson(Object.assign(new Error(message), { status: 400 }), 400);
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const today = dayKey(new Date());
    const earliest = shiftDayKey(today, -(MAX_DAYS - 1));

    const logs = await prisma.listeningLog.findMany({
      where: { userId: auth.user.id, date: { gte: earliest } },
      orderBy: { date: "asc" },
      select: { date: true, seconds: true },
    });

    const days = logs
      .filter((log) => log.seconds > 0)
      .map((log) => ({ date: log.date, seconds: log.seconds }));
    const todaySeconds = days.find((day) => day.date === today)?.seconds ?? 0;

    return jsonWithSession({ today: todaySeconds, days }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const raw: unknown = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

    const rawSeconds = body.seconds;
    if (typeof rawSeconds !== "number" || !Number.isFinite(rawSeconds)) {
      return badRequest("seconds 必须是数字");
    }
    const seconds = Math.min(MAX_STEP_SECONDS, Math.floor(rawSeconds));
    if (seconds < 1) {
      return badRequest("seconds 必须在 1..600 之间");
    }

    const date = dayKey(new Date());
    const log = await prisma.listeningLog.upsert({
      where: { userId_date: { userId: auth.user.id, date } },
      create: { userId: auth.user.id, date, seconds },
      update: { seconds: { increment: seconds } },
      select: { date: true, seconds: true },
    });

    return jsonWithSession({ date: log.date, seconds: log.seconds }, auth);
  } catch (e) {
    return errorJson(e, 400);
  }
}
