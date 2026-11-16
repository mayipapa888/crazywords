import { addDays, startOfDay } from "date-fns";

export type Grade = "again" | "hard" | "good" | "easy";

export type SrsPatch = {
  status: string;
  easeFactor: number;
  intervalDays: number;
  dueAt: Date;
  reps: number;
  lapses: number;
  lastResult: Grade;
};

const MIN_EASE = 1.3;

/**
 * 艾宾浩斯复习间隔（天）：第 n 次成功复习后取第 n 档。
 * 学完 1 次 → 1 天，2 次 → 2 天，3 次 → 4 天，…… 7 次及以后 → 60 天。
 */
export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30, 60] as const;

/** 成功复习次数（1 起）→ 间隔天数；越界后固定停在最后一档 60 天。 */
function intervalForReps(reps: number): number {
  const index = Math.min(Math.max(reps, 1), EBBINGHAUS_INTERVALS.length) - 1;
  return EBBINGHAUS_INTERVALS[index] ?? EBBINGHAUS_INTERVALS[EBBINGHAUS_INTERVALS.length - 1];
}

/**
 * 艾宾浩斯记忆曲线排程。
 *
 * - good（答对）：reps + 1，按序列取新的间隔，dueAt = 今天 + intervalDays，status = "review"。
 * - again（答错）：lapses + 1，reps 归零（重新从序列第一档开始），间隔 1 天，明天到期，status = "relearning"。
 * - 新卡（status === "new"）首次成功：reps 0 → 1，落在序列第一档（1 天）。
 * - hard / easy 为旧接口保留：不再走 SM-2 的独立倍率分支，统一按成功复习推进曲线，
 *   仅微调 easeFactor（hard -0.15 / easy +0.15），因此 attempt 接口的现有调用无需改动。
 */
export function applyGrade(
  card: {
    status: string;
    easeFactor: number;
    intervalDays: number;
    reps: number;
    lapses: number;
  },
  grade: Grade,
  now = new Date(),
): SrsPatch {
  let { easeFactor, reps, lapses, status } = card;
  const today = startOfDay(now);

  if (grade === "again") {
    lapses += 1;
    reps = 0;
    status = "relearning";
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    return {
      status,
      easeFactor,
      intervalDays: 1,
      dueAt: addDays(today, 1),
      reps,
      lapses,
      lastResult: grade,
    };
  }

  if (grade === "hard") {
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.15);
  } else if (grade === "easy") {
    easeFactor += 0.15;
  }

  // 新卡 reps 为 0，+1 后正好落在序列第一档 1 天；答错重置后同理重新开始。
  reps += 1;
  const intervalDays = intervalForReps(reps);

  return {
    status: "review",
    easeFactor,
    intervalDays,
    dueAt: addDays(today, intervalDays),
    reps,
    lapses,
    lastResult: grade,
  };
}

export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
