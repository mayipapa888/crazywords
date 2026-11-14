"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type DayStat = {
  words: number;
  correct: number;
  points: number;
};

type CalendarResponse = {
  month: string;
  today: string;
  days: Record<string, DayStat>;
  monthWords: number;
  monthDays: number;
  monthPoints: number;
  totalPoints: number;
  streak: number;
};

type CalendarCell = {
  day: number;
  key: string;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function parseMonth(month: string): { year: number; monthIndex: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

function monthLabel(month: string): string {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  return `${parsed.year} 年 ${parsed.monthIndex + 1} 月`;
}

function shiftMonth(month: string, delta: number): string {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  const shifted = new Date(parsed.year, parsed.monthIndex + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

/** 周一为一周第一天；返回 7 的倍数个格子，月初/月末空位为 null。 */
function buildCalendar(month: string): { cells: (CalendarCell | null)[]; rows: number } {
  const parsed = parseMonth(month);
  if (!parsed) return { cells: [], rows: 0 };

  const firstWeekday = new Date(parsed.year, parsed.monthIndex, 1).getDay();
  const lead = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(parsed.year, parsed.monthIndex + 1, 0).getDate();

  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, key: `${month}-${String(day).padStart(2, "0")}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return { cells, rows: cells.length / 7 };
}

/** 颜色深浅按当天词数：1–9 浅、10–19 中、20+ 深；无打卡为浅灰。 */
function intensityStyle(words: number): CSSProperties {
  if (words >= 20) {
    return { backgroundColor: "var(--teal)", color: "var(--paper)" };
  }
  if (words >= 10) {
    return {
      backgroundColor: "color-mix(in srgb, var(--teal) 45%, #ffffff)",
      color: "var(--ink)",
    };
  }
  if (words >= 1) {
    return { backgroundColor: "var(--teal-soft)", color: "var(--ink)" };
  }
  return { backgroundColor: "var(--paper)", color: "var(--muted)" };
}

function DayCell({
  cell,
  stat,
  isToday,
}: {
  cell: CalendarCell;
  stat: DayStat | undefined;
  isToday: boolean;
}) {
  const words = stat?.words ?? 0;
  const dark = words >= 20;
  const detail = stat
    ? `${stat.correct} 词正确 · ${stat.points} 分`
    : "未打卡";

  return (
    <div
      className={`flex min-h-0 flex-col justify-between rounded-md border border-[var(--line)] px-1.5 py-1 ${
        isToday ? "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--panel)]" : ""
      }`}
      style={intensityStyle(words)}
      title={`${cell.key} · ${words} 词 · ${detail}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold leading-none">{cell.day}</span>
        {isToday && (
          <span
            className={`text-[10px] font-semibold leading-none ${
              dark ? "text-white" : "text-[var(--accent)]"
            }`}
          >
            今天
          </span>
        )}
      </div>
      <span className="truncate text-[11px] leading-none">
        {words > 0 ? `${words} 词` : "—"}
      </span>
    </div>
  );
}

function fmt(value: number | undefined): string {
  return value === undefined ? "—" : String(value);
}

export default function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (targetMonth: string | null) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const query = targetMonth ? `?month=${encodeURIComponent(targetMonth)}` : "";
      const res = await fetch(`/api/stats/calendar${query}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const payload: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `请求失败（HTTP ${res.status}）`;
        throw new Error(message);
      }

      const response = payload as CalendarResponse | null;
      if (
        !response ||
        typeof response.month !== "string" ||
        typeof response.days !== "object" ||
        response.days === null
      ) {
        throw new Error("返回数据格式异常");
      }

      setData(response);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "网络异常，请稍后重试");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(null);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [load]);

  const calendar = useMemo(() => buildCalendar(data?.month ?? ""), [data?.month]);
  const dayStats = data?.days;

  const goMonth = (delta: number) => {
    if (!data) return;
    void load(shiftMonth(data.month, delta));
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="font-display text-xl">打卡</h1>
          <span className="badge">{data ? monthLabel(data.month) : "加载中…"}</span>
          {loading && <span className="text-[11px] text-[var(--muted)]">加载中…</span>}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={() => goMonth(-1)}
              disabled={!data || loading}
            >
              上一月
            </button>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={() => goMonth(1)}
              disabled={!data || loading}
            >
              下一月
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--muted)]">
          <span>
            本月 <span className="font-medium text-[var(--ink)]">{fmt(data?.monthDays)}</span>{" "}
            天 ·{" "}
            <span className="font-medium text-[var(--ink)]">{fmt(data?.monthWords)}</span> 词 ·{" "}
            <span className="font-medium text-[var(--ink)]">{fmt(data?.monthPoints)}</span> 分
          </span>
          <span className="badge badge-ok">累计 {fmt(data?.totalPoints)} 分</span>
          <span className="badge">连续 {fmt(data?.streak)} 天</span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 rounded-md bg-[var(--danger-soft)] px-3 py-1.5 text-xs text-[var(--danger)]"
        >
          <span>加载失败：{error}</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            onClick={() => void load(data?.month ?? null)}
          >
            重试
          </button>
        </div>
      )}

      <div
        className="panel no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2"
        aria-busy={loading}
      >
        <div className="grid shrink-0 grid-cols-7 gap-1 text-center text-[11px] text-[var(--muted)]">
          {WEEKDAYS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        {data ? (
          <div
            className="grid min-h-0 flex-1 grid-cols-7 gap-1"
            style={{ gridTemplateRows: `repeat(${calendar.rows || 1}, minmax(0, 1fr))` }}
          >
            {calendar.cells.map((cell, index) =>
              cell ? (
                <DayCell
                  key={cell.key}
                  cell={cell}
                  stat={dayStats?.[cell.key]}
                  isToday={data.today === cell.key}
                />
              ) : (
                <div
                  key={`empty-${index}`}
                  className="rounded-md border border-transparent"
                  aria-hidden="true"
                />
              ),
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--muted)]">
            {error ? "无法加载打卡数据" : "加载中…"}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
        <p>
          本月打卡 <span className="font-medium text-[var(--ink)]">{fmt(data?.monthDays)}</span> 天 ·
          本月 <span className="font-medium text-[var(--ink)]">{fmt(data?.monthWords)}</span> 词 ·
          本月 <span className="font-medium text-[var(--ink)]">{fmt(data?.monthPoints)}</span> 分
        </p>
        <p className="text-[11px]">积分：每词 +10 分 · 当日打卡 +20 分</p>
        <p className="flex items-center gap-2">
          <span className="badge badge-ok">累计积分 {fmt(data?.totalPoints)}</span>
          <span className="badge">连续打卡 {fmt(data?.streak)} 天</span>
        </p>
      </div>
    </div>
  );
}
