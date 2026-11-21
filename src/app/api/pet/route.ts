import type { Prisma } from "@prisma/client";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  DEFAULT_PET_NAME,
  EMPTY_BREAKDOWN,
  MAX_STAGE,
  MAX_TICKETS,
  clampStage,
  computeDailyExp,
  dayKey,
  dayRangeUtc,
  mergeBreakdown,
  nextStageExp,
  parseDailyExp,
  sanitizePetName,
  serializeDailyExp,
  stageName,
  stageOfExp,
  stageProgress,
  sumBreakdown,
  ticketsAfterStageUps,
  type DailySourceStats,
  type PetBreakdown,
} from "@/lib/pet/rules";

/**
 * 宠物状态接口。
 *
 * 不做事物流水：每次 GET（以及 POST feed / rename 返回前）从既有学习数据
 * 惰性推导「今天应得的 EXP」，与 Pet.lastExpDate / dailyExpJson 比较后补差额。
 * 同一天内源数据只会增长，因此按来源取 max 合并即可，不会重复发经验。
 */

/** 每次请求都要读库并可能写回结算结果，禁止静态化/缓存 */
export const dynamic = "force-dynamic";

type PetRow = {
  id: string;
  userId: string;
  name: string;
  stage: number;
  exp: number;
  tickets: number;
  lastExpDate: string;
  dailyExpJson: string;
  createdAt: Date;
  updatedAt: Date;
};

type SettledPet = {
  pet: PetRow;
  today: string;
  breakdown: PetBreakdown;
};

/** 事务写冲突 / 连接池超时 / SQLite 忙锁：重试即可，算法本身幂等 */
function isRetryableTransactionError(e: unknown): boolean {
  const code =
    e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined;
  if (code === "P2034" || code === "P2024") return true;
  const message = e instanceof Error ? e.message : "";
  return /database is locked/i.test(message);
}

function badRequest(message: string) {
  return errorJson(Object.assign(new Error(message), { status: 400 }), 400);
}

/** 查今天的原始学习数据（Asia/Shanghai 当天） */
async function loadTodayStats(userId: string, today: string): Promise<DailySourceStats> {
  const { start, end } = dayRangeUtc(today);

  const [attempts, listening, newNotes] = await Promise.all([
    prisma.attempt.findMany({
      where: {
        session: { userId },
        createdAt: { gte: start, lt: end },
      },
      select: { entryId: true, overallOk: true },
    }),
    prisma.listeningLog.findUnique({
      where: { userId_date: { userId, date: today } },
      select: { seconds: true },
    }),
    prisma.knowledgeNote.count({
      where: { userId, createdAt: { gte: start, lt: end } },
    }),
  ]);

  const correctEntries = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.overallOk) correctEntries.add(attempt.entryId);
  }

  return {
    dictationCorrectWords: correctEntries.size,
    listeningSeconds: Math.max(0, listening?.seconds ?? 0),
    hasAttempt: attempts.length > 0,
    newNotes,
  };
}

const ensurePet = (tx: Prisma.TransactionClient, userId: string) =>
  tx.pet.upsert({
    where: { userId },
    create: { userId, name: DEFAULT_PET_NAME },
    update: {},
  });

/**
 * 在事务里结算当天经验：
 * - 换天：dailyExpJson 归零，按新一天重新结算；
 * - 同天：逐来源 max(已入账, 应得)，只补差额；
 * - 结算后按累计 EXP 重算 stage，每跨一级 tickets + 1（封顶 3）。
 */
async function settlePet(userId: string): Promise<SettledPet> {
  const today = dayKey(new Date());
  const stats = await loadTodayStats(userId, today);
  const target = computeDailyExp(stats);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const pet = await prisma.$transaction(async (tx) => {
        const current = await ensurePet(tx, userId);
        const sameDay = current.lastExpDate === today;
        // 跨零点竞态：另一次请求已按“更新的一天”结算，本次旧日期不得回写，
        // 否则会把 lastExpDate 拨回昨天，导致新一天的经验被重复补发。
        if (!sameDay && current.lastExpDate > today) return current;

        const earned = sameDay ? parseDailyExp(current.dailyExpJson) : { ...EMPTY_BREAKDOWN };
        const merged = mergeBreakdown(earned, target);
        const gained = sumBreakdown(merged) - sumBreakdown(earned);

        const exp = Math.max(0, current.exp) + gained;
        const stage = stageOfExp(exp);
        const tickets = ticketsAfterStageUps(current.tickets, current.stage, stage);
        const dailyExpJson = serializeDailyExp(merged);

        const changed =
          !sameDay ||
          gained > 0 ||
          stage !== current.stage ||
          tickets !== current.tickets ||
          dailyExpJson !== current.dailyExpJson;

        if (!changed) return current;

        return tx.pet.update({
          where: { userId },
          data: { stage, exp, tickets, lastExpDate: today, dailyExpJson },
        });
      });

      return {
        pet,
        today,
        breakdown: pet.lastExpDate === today ? parseDailyExp(pet.dailyExpJson) : { ...EMPTY_BREAKDOWN },
      };
    } catch (e) {
      if (!isRetryableTransactionError(e) || attempt === 2) throw e;
    }
  }

  throw new Error("宠物经验结算失败，请稍后重试");
}

/** 接口返回结构；todayBreakdown 四来源始终存在（无则 0） */
function toPayload({ pet, breakdown }: SettledPet) {
  const exp = Math.max(0, pet.exp);
  const stage = clampStage(stageOfExp(exp));
  return {
    name: pet.name,
    stage,
    stageName: stageName(stage),
    exp,
    nextStageExp: nextStageExp(exp),
    progress: Math.round(stageProgress(exp) * 1000) / 1000,
    tickets: Math.min(MAX_TICKETS, Math.max(0, pet.tickets)),
    todayExp: sumBreakdown(breakdown),
    todayBreakdown: breakdown,
    maxStage: MAX_STAGE,
  };
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const settled = await settlePet(auth.user.id);
    return jsonWithSession({ pet: toPayload(settled) }, auth);
  } catch (e) {
    return errorJson(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const raw: unknown = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const action = body.action;

    if (action === "rename") {
      const parsed = sanitizePetName(body.name);
      if (!parsed.ok) return badRequest(parsed.error);

      // upsert 同时覆盖「首次进入」与「改名」，避免额外一次查询
      await prisma.pet.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id, name: parsed.value },
        update: { name: parsed.value },
      });

      const settled = await settlePet(auth.user.id);
      return jsonWithSession({ pet: toPayload(settled) }, auth);
    }

    if (action === "feed") {
      // 预留互动入口：暂不影响经验，只返回结算后的当前状态
      const settled = await settlePet(auth.user.id);
      return jsonWithSession({ pet: toPayload(settled) }, auth);
    }

    return badRequest("action 必须是 rename 或 feed");
  } catch (e) {
    return errorJson(e, 400);
  }
}
