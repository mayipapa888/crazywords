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

/** 简化 SM-2（产品方案 §4.2） */
export function applyGrade(card: {
  status: string;
  easeFactor: number;
  intervalDays: number;
  reps: number;
  lapses: number;
}, grade: Grade, now = new Date()): SrsPatch {
  let { easeFactor, intervalDays, reps, lapses, status } = card;
  const today = startOfDay(now);

  if (grade === "again") {
    lapses += 1;
    status = "relearning";
    intervalDays = 1;
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    return {
      status,
      easeFactor,
      intervalDays,
      dueAt: addDays(today, 1),
      reps,
      lapses,
      lastResult: grade,
    };
  }

  if (grade === "hard") {
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.15);
    intervalDays = Math.max(1, Math.round(Math.max(intervalDays, 1) * 1.2));
  } else if (grade === "good") {
    if (reps === 0 || status === "new" || status === "relearning") {
      intervalDays = 1;
    } else if (reps === 1) {
      intervalDays = 3;
    } else {
      intervalDays = Math.max(intervalDays + 1, Math.round(intervalDays * easeFactor));
    }
  } else if (grade === "easy") {
    easeFactor += 0.15;
    if (reps === 0) {
      intervalDays = 3;
    } else {
      intervalDays = Math.max(
        intervalDays + 1,
        Math.round(intervalDays * easeFactor * 1.3),
      );
    }
  }

  reps += 1;
  status = "review";

  return {
    status,
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
