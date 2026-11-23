/**
 * 宠物养成规则的唯一数据源。
 *
 * 页面 / API 都从这里取常量与纯函数，保证「阶段门槛、经验来源、每日上限」
 * 只有一份定义。本文件不依赖 Prisma / React，可同时用于服务端与客户端。
 */

/** 结算经验使用的时区：自然日一律按 Asia/Shanghai 计算 */
export const PET_TZ = "Asia/Shanghai";

/** 默认宠物名 */
export const DEFAULT_PET_NAME = "小星";

/** 改名上限（按 Unicode 字符计，不是 UTF-16 码元） */
export const NAME_MAX_LENGTH = 12;

/** 最高阶段 */
export const MAX_STAGE = 8;

/** 吃鸡券上限（超出部分直接丢弃） */
export const MAX_TICKETS = 20;

/** 每累计多少 EXP 发放 1 张吃鸡券 */
export const TICKET_MILESTONE_EXP = 100;

/** 喂食：每次消耗的积分 */
export const FEED_POINTS_COST = 20;
/** 喂食：每次获得的 EXP */
export const FEED_EXP = 10;
/** 喂食：每天最多次数 */
export const FEED_DAILY_CAP = 3;

/** 吃鸡战绩经验：吃鸡 */
export const BATTLE_EXP_WIN = 60;
/** 吃鸡战绩经验：前 3 名 */
export const BATTLE_EXP_TOP3 = 40;
/** 吃鸡战绩经验：前 10 名 */
export const BATTLE_EXP_TOP10 = 20;
/** 吃鸡战绩经验：其余名次 */
export const BATTLE_EXP_FINISH = 5;
/** 吃鸡战绩经验：每击杀 */
export const BATTLE_EXP_PER_KILL = 5;
/** 吃鸡战绩经验：击杀部分上限 */
export const BATTLE_KILL_EXP_CAP = 25;

export type PetStage = {
  stage: number;
  name: string;
  /** 达到该阶段所需的累计 EXP */
  minExp: number;
};

/** 5 个阶段与累计 EXP 门槛（升序） */
export const STAGES: readonly PetStage[] = [
  { stage: 1, name: "蛋", minExp: 0 },
  { stage: 2, name: "幼崽", minExp: 150 },
  { stage: 3, name: "少年", minExp: 400 },
  { stage: 4, name: "青年", minExp: 900 },
  { stage: 5, name: "成年", minExp: 1600 },
  { stage: 6, name: "精英", minExp: 2600 },
  { stage: 7, name: "传说", minExp: 4000 },
  { stage: 8, name: "神话", minExp: 7000 },
];

/* -------------------------------------------------------------------------- */
/* 经验来源与每日上限                                                          */
/* -------------------------------------------------------------------------- */

/** 听写：每个答对的去重单词 */
export const EXP_PER_CORRECT_WORD = 2;
/** 听写：每日上限（30 个词） */
export const DICTATION_DAILY_CAP = 60;

/** 磨耳朵：每满 5 分钟 */
export const LISTENING_STEP_SECONDS = 300;
export const EXP_PER_LISTENING_STEP = 3;
/** 磨耳朵：每日上限（50 分钟） */
export const LISTENING_DAILY_CAP = 30;

/** 当日打卡（有任意听写记录） */
export const CHECKIN_EXP = 10;
export const CHECKIN_DAILY_CAP = 10;

/** 新增知识点：每条 */
export const EXP_PER_NOTE = 5;
/** 知识点：每日上限（3 条） */
export const NOTE_DAILY_CAP = 15;

export type PetSource = "dictation" | "listening" | "checkin" | "notes";

/** 单日各来源已获得的 EXP（dailyExpJson 的结构） */
export type PetBreakdown = Record<PetSource, number>;

export type ExpSource = {
  key: PetSource;
  /** 页面展示用短名 */
  label: string;
  icon: string;
  /** 每个计费单位的 EXP */
  exp: number;
  /** 每日上限 */
  dailyCap: number;
  /** 计费单位说明 */
  detail: string;
};

/** 页面「今日经验明细 / 规则说明」按该顺序渲染 */
export const EXP_SOURCES: readonly ExpSource[] = [
  {
    key: "dictation",
    label: "听写",
    icon: "✍️",
    exp: EXP_PER_CORRECT_WORD,
    dailyCap: DICTATION_DAILY_CAP,
    detail: "每答对 1 词",
  },
  {
    key: "listening",
    label: "磨耳朵",
    icon: "🎧",
    exp: EXP_PER_LISTENING_STEP,
    dailyCap: LISTENING_DAILY_CAP,
    detail: `每满 ${LISTENING_STEP_SECONDS / 60} 分钟`,
  },
  {
    key: "checkin",
    label: "打卡",
    icon: "📅",
    exp: CHECKIN_EXP,
    dailyCap: CHECKIN_DAILY_CAP,
    detail: "当日有听写",
  },
  {
    key: "notes",
    label: "知识点",
    icon: "📒",
    exp: EXP_PER_NOTE,
    dailyCap: NOTE_DAILY_CAP,
    detail: "每新增 1 条",
  },
];

/** 每日理论最高 EXP（60 + 30 + 10 + 15 = 115） */
export const MAX_DAILY_EXP = EXP_SOURCES.reduce((sum, source) => sum + source.dailyCap, 0);

export const EMPTY_BREAKDOWN: PetBreakdown = {
  dictation: 0,
  listening: 0,
  checkin: 0,
  notes: 0,
};

/** 今天从既有数据推导出的原始计数 */
export type DailySourceStats = {
  /** 今天 overallOk = true 的去重 entryId 数 */
  dictationCorrectWords: number;
  /** 今天磨耳朵累计秒数 */
  listeningSeconds: number;
  /** 今天是否有任意 Attempt（打卡判定） */
  hasAttempt: boolean;
  /** 今天新增的 KnowledgeNote 条数 */
  newNotes: number;
};

/** 推导今天各来源「应得」的 EXP（已按每日上限截断） */
export function computeDailyExp(stats: DailySourceStats): PetBreakdown {
  const dictation = Math.min(
    DICTATION_DAILY_CAP,
    Math.max(0, Math.floor(stats.dictationCorrectWords)) * EXP_PER_CORRECT_WORD,
  );
  const listeningSteps = Math.floor(Math.max(0, stats.listeningSeconds) / LISTENING_STEP_SECONDS);
  const listening = Math.min(
    LISTENING_DAILY_CAP,
    Math.max(0, listeningSteps) * EXP_PER_LISTENING_STEP,
  );
  const checkin = stats.hasAttempt ? Math.min(CHECKIN_DAILY_CAP, CHECKIN_EXP) : 0;
  const notes = Math.min(
    NOTE_DAILY_CAP,
    Math.max(0, Math.floor(stats.newNotes)) * EXP_PER_NOTE,
  );
  return { dictation, listening, checkin, notes };
}

/** 四个来源一律补齐为数字，非法值按 0 处理 */
export function normalizeBreakdown(raw: Partial<PetBreakdown> | null | undefined): PetBreakdown {
  const pick = (value: unknown): number => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  return {
    dictation: pick(raw?.dictation),
    listening: pick(raw?.listening),
    checkin: pick(raw?.checkin),
    notes: pick(raw?.notes),
  };
}

/** 解析 dailyExpJson；损坏的 JSON 视为空 */
export function parseDailyExp(raw: string | null | undefined): PetBreakdown {
  if (!raw) return { ...EMPTY_BREAKDOWN };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...EMPTY_BREAKDOWN };
    }
    return normalizeBreakdown(parsed as Partial<PetBreakdown>);
  } catch {
    return { ...EMPTY_BREAKDOWN };
  }
}

export function serializeDailyExp(breakdown: PetBreakdown): string {
  return JSON.stringify(normalizeBreakdown(breakdown));
}

export function sumBreakdown(breakdown: Partial<PetBreakdown> | null | undefined): number {
  const normalized = normalizeBreakdown(breakdown);
  return EXP_SOURCES.reduce((sum, source) => sum + normalized[source.key], 0);
}

/**
 * 合并「已入账」与「今天应得」：逐来源取较大值。
 * 已获得的经验不会因为源数据被删除而回退，也避免重复补发。
 */
export function mergeBreakdown(earned: PetBreakdown, target: PetBreakdown): PetBreakdown {
  const a = normalizeBreakdown(earned);
  const b = normalizeBreakdown(target);
  return {
    dictation: Math.max(a.dictation, b.dictation),
    listening: Math.max(a.listening, b.listening),
    checkin: Math.max(a.checkin, b.checkin),
    notes: Math.max(a.notes, b.notes),
  };
}

/* -------------------------------------------------------------------------- */
/* 阶段 / 经验                                                                 */
/* -------------------------------------------------------------------------- */

export function clampStage(stage: number): number {
  if (!Number.isFinite(stage)) return 1;
  return Math.min(MAX_STAGE, Math.max(1, Math.floor(stage)));
}

/** 累计 EXP 对应的阶段（1..5） */
export function stageOfExp(exp: number): number {
  const value = Number.isFinite(exp) ? Math.max(0, exp) : 0;
  let stage = 1;
  for (const item of STAGES) {
    if (value >= item.minExp) stage = item.stage;
    else break;
  }
  return stage;
}

export function stageInfo(stage: number): PetStage {
  return STAGES[clampStage(stage) - 1];
}

export function stageName(stage: number): string {
  return stageInfo(stage).name;
}

/** 下一阶段门槛；已满级返回 null */
export function nextStageExp(exp: number): number | null {
  const next = STAGES[stageOfExp(exp)];
  return next ? next.minExp : null;
}

/** 当前阶段内的进度 0..1；已满级返回 1 */
export function stageProgress(exp: number): number {
  const value = Number.isFinite(exp) ? Math.max(0, exp) : 0;
  const current = stageInfo(stageOfExp(value));
  const next = STAGES[current.stage];
  if (!next) return 1;
  const span = next.minExp - current.minExp;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (value - current.minExp) / span));
}

/* -------------------------------------------------------------------------- */
/* 吃鸡券：累计里程碑 + 升阶奖励                                                */
/* -------------------------------------------------------------------------- */

/** 累计 EXP 对应的「应发里程碑券数」：每满 100 EXP 一张 */
export function milestoneTicketTarget(exp: number): number {
  const value = Number.isFinite(exp) ? Math.max(0, Math.floor(exp)) : 0;
  return Math.floor(value / TICKET_MILESTONE_EXP);
}

/**
 * 升阶奖励：由第 n 阶升到第 n+1 阶时发 (n + 1) 张。
 * 跨多阶则逐级累加（3 → 5 = +4 +5 = 9 张）。
 */
export function stageUpTicketReward(fromStage: number, toStage: number): number {
  const from = clampStage(fromStage);
  const to = clampStage(toStage);
  let gain = 0;
  for (let stage = from + 1; stage <= to; stage += 1) gain += stage;
  return gain;
}

export type TicketSettlement = {
  /** 结算后的券数（已封顶 MAX_TICKETS） */
  tickets: number;
  /** 已发放过的里程碑券数（只增不减，保证重复结算不重复发券） */
  milestoneIssued: number;
  /** 本次实际新增的券数（可能是 0，封顶时被丢弃） */
  gained: number;
};

/**
 * 幂等的券结算：以「已发放里程碑数 milestoneIssued」为水位线，只补发差额；
 * 升阶奖励以数据库里的旧 stage 为起点，只对本次新跨过的阶段发券。
 * 调用方必须把返回的 milestoneIssued 一并写回，重复调用才不会重复发券。
 */
export function settleTickets(input: {
  tickets: number;
  exp: number;
  milestoneIssued: number;
  fromStage: number;
  toStage: number;
}): TicketSettlement {
  const current = Number.isFinite(input.tickets) ? Math.max(0, Math.floor(input.tickets)) : 0;
  const issued = Number.isFinite(input.milestoneIssued)
    ? Math.max(0, Math.floor(input.milestoneIssued))
    : 0;
  const target = milestoneTicketTarget(input.exp);
  const milestoneGain = Math.max(0, target - issued);
  const stageGain = stageUpTicketReward(input.fromStage, input.toStage);
  const tickets = Math.min(MAX_TICKETS, current + milestoneGain + stageGain);
  return {
    tickets,
    milestoneIssued: Math.max(issued, target),
    gained: tickets - current,
  };
}

/* -------------------------------------------------------------------------- */
/* 喂食 / 吃鸡战绩经验                                                          */
/* -------------------------------------------------------------------------- */

export type BattleExpResult = {
  /** 合计获得 EXP */
  total: number;
  /** 名次部分 */
  placement: number;
  /** 击杀部分（已封顶） */
  kills: number;
};

/** 吃鸡战绩经验：名次 + 击杀（每击杀 +5，最多 +25） */
export function battleExp(kills: number, placement: number): BattleExpResult {
  const place = Number.isFinite(placement) ? Math.floor(placement) : 0;
  const killsCount = Number.isFinite(kills) ? Math.max(0, Math.floor(kills)) : 0;
  const placementExp =
    place === 1
      ? BATTLE_EXP_WIN
      : place >= 2 && place <= 3
        ? BATTLE_EXP_TOP3
        : place >= 4 && place <= 10
          ? BATTLE_EXP_TOP10
          : BATTLE_EXP_FINISH;
  const killExp = Math.min(BATTLE_KILL_EXP_CAP, killsCount * BATTLE_EXP_PER_KILL);
  return { total: placementExp + killExp, placement: placementExp, kills: killExp };
}

/* -------------------------------------------------------------------------- */
/* 日期 / 名称                                                                 */
/* -------------------------------------------------------------------------- */

type DatePart = "year" | "month" | "day";

const dayKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 按 Asia/Shanghai 本地日生成 YYYY-MM-DD 键，与进程时区无关 */
export function dayKey(date: Date): string {
  const parts = dayKeyFormatter.formatToParts(date);
  const pick = (type: DatePart) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/**
 * 把 YYYY-MM-DD 转成 [当天 00:00, 次日 00:00) 的 UTC 时间区间。
 * Asia/Shanghai 自 1991 年起无夏令时，固定 UTC+8。
 */
export function dayRangeUtc(key: string): { start: Date; end: Date } {
  const start = new Date(`${key}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export type PetNameResult = { ok: true; value: string } | { ok: false; error: string };

/** 校验宠物名：去首尾空白、非空、按字符数 <= 12 */
export function sanitizePetName(raw: unknown): PetNameResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "名称格式不正确" };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: "名称不能为空" };
  }
  const chars = Array.from(value);
  if (chars.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `名称最多 ${NAME_MAX_LENGTH} 个字` };
  }
  return { ok: true, value: chars.join("") };
}
