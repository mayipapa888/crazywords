/**
 * 宠物养成 / 吃鸡经济的服务端结算逻辑（唯一实现）。
 *
 * 为什么单独成文件：Next.js 的 route.ts 只允许导出 HTTP 方法等约定字段，
 * 所以「结算今日经验、发券、喂食扣积分、构造返回结构」等共享逻辑放在这里，
 * 由 /api/pet 与 /api/pet/battle/* 共同引用，避免多处实现造成规则漂移。
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computePoints, shanghaiDayStart } from "@/lib/points";
import {
  DEFAULT_PET_NAME,
  EMPTY_BREAKDOWN,
  FEED_DAILY_CAP,
  FEED_EXP,
  FEED_POINTS_COST,
  MAX_STAGE,
  MAX_TICKETS,
  TICKET_MILESTONE_EXP,
  clampStage,
  computeDailyExp,
  dayKey,
  dayRangeUtc,
  mergeBreakdown,
  milestoneTicketTarget,
  nextStageExp,
  parseDailyExp,
  serializeDailyExp,
  settleTickets,
  stageName,
  stageOfExp,
  stageProgress,
  sumBreakdown,
  type DailySourceStats,
  type PetBreakdown,
} from "@/lib/pet/rules";

/** Pet 行的形状（显式声明，避免把 Prisma 生成类型的细节泄漏到调用方） */
export type PetRow = {
  id: string;
  userId: string;
  name: string;
  stage: number;
  exp: number;
  tickets: number;
  milestoneIssued: number;
  feedCountToday: number;
  feedDate: string;
  lastExpDate: string;
  dailyExpJson: string;
  createdAt: Date;
  updatedAt: Date;
};

/** 累计 / 已消耗 / 可用积分 */
export type PointsState = {
  totalPoints: number;
  spentPoints: number;
  availablePoints: number;
};

export type SettledPet = {
  pet: PetRow;
  today: string;
  breakdown: PetBreakdown;
};

type LearningSettlement = {
  exp: number;
  stage: number;
  tickets: number;
  milestoneIssued: number;
  dailyExpJson: string;
  breakdown: PetBreakdown;
  feedCountToday: number;
  feedDate: string;
};

/* -------------------------------------------------------------------------- */
/* 事务工具                                                                    */
/* -------------------------------------------------------------------------- */

/** 事务写冲突 / 连接池超时 / SQLite 忙锁：重试即可，算法本身幂等 */
export function isRetryableTransactionError(e: unknown): boolean {
  const code =
    e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined;
  if (code === "P2034" || code === "P2024") return true;
  const message = e instanceof Error ? e.message : "";
  return /database is locked/i.test(message);
}

/** 对可重试的事务错误最多重试 3 次 */
export async function withRetryableTransaction<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run();
    } catch (e) {
      if (!isRetryableTransactionError(e) || attempt === 2) throw e;
    }
  }
  throw new Error("事务重试失败，请稍后重试");
}

/** 带 HTTP 状态码的业务错误，供 errorJson 原样返回 */
export function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/* -------------------------------------------------------------------------- */
/* 读库                                                                        */
/* -------------------------------------------------------------------------- */

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

/**
 * 当前可用积分 = 累计学习积分（computePoints）− SUM(PointSpend.amount)。
 * 喂食等消耗通过插入 PointSpend 实现，累计积分本身不回写。
 */
export async function loadPointsState(userId: string): Promise<PointsState> {
  const [summary, spend] = await Promise.all([
    // 积分从「今天」重新起算：只统计上海时区今天 0 点之后的学习所得。
    computePoints(userId, new Date(), shanghaiDayStart()),
    prisma.pointSpend.aggregate({ where: { userId }, _sum: { amount: true } }),
  ]);
  const totalPoints = Math.max(0, summary.totalPoints);
  const spentPoints = Math.max(0, spend._sum.amount ?? 0);
  return {
    totalPoints,
    spentPoints,
    availablePoints: Math.max(0, totalPoints - spentPoints),
  };
}

export const ensurePet = (tx: Prisma.TransactionClient, userId: string): Promise<PetRow> =>
  tx.pet.upsert({
    where: { userId },
    create: { userId, name: DEFAULT_PET_NAME },
    update: {},
  });

/* -------------------------------------------------------------------------- */
/* 结算                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 纯计算：把「今天应得」的学习经验并进当前 Pet，并结算里程碑券 / 升阶券。
 * 不写库，由调用方在同一个事务里 update，喂食可在同一事务里继续加经验。
 */
function settleLearning(
  current: PetRow,
  today: string,
  target: PetBreakdown,
): LearningSettlement {
  const sameDay = current.lastExpDate === today;
  const earned = sameDay ? parseDailyExp(current.dailyExpJson) : { ...EMPTY_BREAKDOWN };
  const merged = mergeBreakdown(earned, target);
  const gained = sumBreakdown(merged) - sumBreakdown(earned);

  const exp = Math.max(0, current.exp) + gained;
  const stage = stageOfExp(exp);
  const ticketState = settleTickets({
    tickets: current.tickets,
    exp,
    milestoneIssued: current.milestoneIssued,
    // 以「当前 EXP 对应的阶段」为起点：即使 stage 列滞后也不会重复发升阶券
    fromStage: stageOfExp(current.exp),
    toStage: stage,
  });

  // 每天（Asia/Shanghai）重置喂食次数；请求日期落后于已记录日期时不回退
  const feedInFuture = current.feedDate > today;
  const feedToday = current.feedDate === today;

  return {
    exp,
    stage,
    tickets: ticketState.tickets,
    milestoneIssued: ticketState.milestoneIssued,
    dailyExpJson: serializeDailyExp(merged),
    breakdown: merged,
    feedCountToday: feedToday || feedInFuture ? Math.max(0, current.feedCountToday) : 0,
    feedDate: feedToday || feedInFuture ? current.feedDate : today,
  };
}

/** 结算学习经验（GET / rename / feed 都会先走这一步） */
export async function settlePet(userId: string): Promise<SettledPet> {
  const today = dayKey(new Date());
  const stats = await loadTodayStats(userId, today);
  const target = computeDailyExp(stats);

  return withRetryableTransaction(async () => {
    const pet = await prisma.$transaction(async (tx) => {
      const current = await ensurePet(tx, userId);
      // 跨零点竞态：另一次请求已按“更新的一天”结算，本次旧日期不得回写，
      // 否则会把 lastExpDate 拨回昨天，导致新一天的经验被重复补发。
      if (current.lastExpDate > today) return current;

      const settled = settleLearning(current, today, target);
      const changed =
        current.lastExpDate !== today ||
        settled.exp !== current.exp ||
        settled.stage !== current.stage ||
        settled.tickets !== current.tickets ||
        settled.milestoneIssued !== current.milestoneIssued ||
        settled.dailyExpJson !== current.dailyExpJson ||
        settled.feedCountToday !== current.feedCountToday ||
        settled.feedDate !== current.feedDate;

      if (!changed) return current;

      return tx.pet.update({
        where: { userId },
        data: {
          exp: settled.exp,
          stage: settled.stage,
          tickets: settled.tickets,
          milestoneIssued: settled.milestoneIssued,
          lastExpDate: today,
          dailyExpJson: settled.dailyExpJson,
          feedCountToday: settled.feedCountToday,
          feedDate: settled.feedDate,
        },
      });
    });

    return {
      pet,
      today,
      breakdown:
        pet.lastExpDate === today ? parseDailyExp(pet.dailyExpJson) : { ...EMPTY_BREAKDOWN },
    };
  });
}

/**
 * 喂食：20 积分 → +30 EXP，每天最多 3 次。
 *
 * 事务内依次做：结算今日学习经验 → 校验次数（事务内实时计数）→ 校验并插入
 * PointSpend 扣分 → 加经验 → 按新 EXP 结算券。任一校验失败整体回滚，不会出现
 * “扣了积分没加经验”或并发超支。
 */
export async function feedPet(userId: string): Promise<SettledPet & { points: PointsState }> {
  const today = dayKey(new Date());
  const stats = await loadTodayStats(userId, today);
  const target = computeDailyExp(stats);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const points = await loadPointsState(userId);
    if (points.availablePoints < FEED_POINTS_COST) throw statusError("积分不足", 400);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const current = await ensurePet(tx, userId);
        if (current.lastExpDate > today) throw statusError("时间异常，请稍后重试", 409);

        const settled = settleLearning(current, today, target);
        if (settled.feedCountToday >= FEED_DAILY_CAP) {
          throw statusError(`今日喂食次数已用完（每天 ${FEED_DAILY_CAP} 次）`, 400);
        }

        // 事务内重算已消耗积分，避免两个并发请求都通过校验后超额消耗
        const spend = await tx.pointSpend.aggregate({
          where: { userId },
          _sum: { amount: true },
        });
        const spentBefore = Math.max(0, spend._sum.amount ?? 0);
        if (points.totalPoints - spentBefore < FEED_POINTS_COST) {
          throw statusError("积分不足", 400);
        }

        await tx.pointSpend.create({
          data: { userId, amount: FEED_POINTS_COST, reason: "feed" },
        });

        // 喂食经验不占用每日学习上限，但同样参与阶段与券结算
        const exp = settled.exp + FEED_EXP;
        const stage = stageOfExp(exp);
        const ticketState = settleTickets({
          tickets: settled.tickets,
          exp,
          milestoneIssued: settled.milestoneIssued,
          fromStage: settled.stage,
          toStage: stage,
        });

        const pet = await tx.pet.update({
          where: { userId },
          data: {
            exp,
            stage,
            tickets: ticketState.tickets,
            milestoneIssued: ticketState.milestoneIssued,
            lastExpDate: today,
            dailyExpJson: settled.dailyExpJson,
            feedCountToday: settled.feedCountToday + 1,
            feedDate: today,
          },
        });

        return { pet, spentAfter: spentBefore + FEED_POINTS_COST };
      });

      return {
        pet: result.pet,
        today,
        breakdown: parseDailyExp(result.pet.dailyExpJson),
        points: {
          totalPoints: points.totalPoints,
          spentPoints: result.spentAfter,
          availablePoints: Math.max(0, points.totalPoints - result.spentAfter),
        },
      };
    } catch (e) {
      if (!isRetryableTransactionError(e) || attempt === 2) throw e;
    }
  }

  throw new Error("喂食失败，请稍后重试");
}

/* -------------------------------------------------------------------------- */
/* 返回结构                                                                    */
/* -------------------------------------------------------------------------- */

/** 接口返回结构；todayBreakdown 四来源始终存在（无则 0），新增字段只增不删 */
export function toPayload(input: {
  pet: PetRow;
  today: string;
  breakdown: PetBreakdown;
  points: PointsState;
}) {
  const exp = Math.max(0, input.pet.exp);
  const stage = clampStage(stageOfExp(exp));
  const feedCountToday =
    input.pet.feedDate === input.today
      ? Math.min(FEED_DAILY_CAP, Math.max(0, input.pet.feedCountToday))
      : 0;

  return {
    name: input.pet.name,
    stage,
    stageName: stageName(stage),
    exp,
    nextStageExp: nextStageExp(exp),
    progress: Math.round(stageProgress(exp) * 1000) / 1000,
    tickets: Math.min(MAX_TICKETS, Math.max(0, input.pet.tickets)),
    maxTickets: MAX_TICKETS,
    todayExp: sumBreakdown(input.breakdown),
    todayBreakdown: input.breakdown,
    maxStage: MAX_STAGE,
    // 喂食
    feedCountToday,
    feedDailyCap: FEED_DAILY_CAP,
    feedPointsCost: FEED_POINTS_COST,
    feedExp: FEED_EXP,
    // 积分（累计 − 已消耗）
    totalPoints: input.points.totalPoints,
    spentPoints: input.points.spentPoints,
    availablePoints: input.points.availablePoints,
    // 券进度
    milestoneIssued: Math.max(0, input.pet.milestoneIssued),
    nextTicketExp: (milestoneTicketTarget(exp) + 1) * TICKET_MILESTONE_EXP,
  };
}
