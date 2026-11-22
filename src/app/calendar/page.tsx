"use client";

import { withBase } from "@/lib/base-path";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { KidArt } from "@/components/Illustrations";

type DayStat = {
  words: number;
  correct: number;
  points: number;
  newWords?: number;
};

type PointsRules = {
  pointsPerWord: number;
  checkinBonus: number;
  newWordBonus: number;
  listeningMinutesPerPoint: number;
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
  rules?: PointsRules;
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

/** 格子内紧凑写法：12m / <1m */
function compactListening(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m` : "<1m";
}

/** 详情/汇总里的完整写法：12 分 30 秒 */
function fullListening(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return `${rest} 秒`;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

function DayCell({
  cell,
  stat,
  listeningSeconds,
  isToday,
  isSelected,
  onSelect,
}: {
  cell: CalendarCell;
  stat: DayStat | undefined;
  listeningSeconds: number;
  isToday: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const words = stat?.words ?? 0;
  const dark = words >= 20;
  const detail = stat
    ? `${stat.correct} 词正确 · ${stat.points} 分`
    : "未打卡";
  const listeningDetail =
    listeningSeconds > 0 ? ` · 磨耳朵 ${fullListening(listeningSeconds)}` : "";

  const ringClass = isToday
    ? "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--panel)]"
    : isSelected
      ? "ring-2 ring-[var(--ink)] ring-offset-1 ring-offset-[var(--panel)]"
      : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`flex min-h-0 cursor-pointer flex-col justify-between rounded-md border border-[var(--line)] px-1.5 py-1 text-left ${ringClass}`}
      style={intensityStyle(words)}
      title={`${cell.key} · ${words} 词 · ${detail}${listeningDetail}`}
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[11px] leading-none">
          {words > 0 ? `${words} 词` : "—"}
        </span>
        {listeningSeconds > 0 && (
          <span
            className={`truncate text-[10px] leading-none ${dark ? "text-white/85" : "text-[var(--muted)]"}`}
          >
            🎧 {compactListening(listeningSeconds)}
          </span>
        )}
      </div>
    </button>
  );
}

function fmt(value: number | undefined): string {
  return value === undefined ? "—" : String(value);
}

const DEFAULT_RULES: PointsRules = {
  pointsPerWord: 10,
  checkinBonus: 20,
  newWordBonus: 5,
  listeningMinutesPerPoint: 5,
};

/** 累计积分徽章：悬停/聚焦时以列表形式展示积分规则 */
function PointsBadge({
  total,
  rules,
  label = "累计",
}: {
  total: number | undefined;
  rules?: PointsRules;
  label?: string;
}) {
  const r = rules ?? DEFAULT_RULES;
  return (
    <span className="group relative inline-flex">
      <span className="badge badge-ok cursor-help underline decoration-dotted underline-offset-2">
        {label} {fmt(total)} 分
      </span>
      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-64 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2.5 text-left text-[11px] leading-relaxed text-[var(--muted)] shadow-xl group-hover:block group-focus-within:block"
      >
        <p className="mb-1 font-medium text-[var(--ink)]">积分规则</p>
        <ul className="space-y-0.5">
          <li>· 听写每个单词 +{r.pointsPerWord} 分（同一天同词只算一次）</li>
          <li>· 首次学到新词 额外 +{r.newWordBonus} 分</li>
          <li>· 当日有听写打卡 +{r.checkinBonus} 分</li>
          <li>· 磨耳朵 每 {r.listeningMinutesPerPoint} 分钟 +1 分</li>
        </ul>
        <p className="mt-1 border-t border-[var(--line)] pt-1 text-[10px]">
          答错不影响单词积分；磨耳朵积分只计入当天有听写打卡的日子
        </p>
      </div>
    </span>
  );
}

export default function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 最近 35 天磨耳朵时长（date → 秒），来自 /api/listening/time */
  const [listeningDays, setListeningDays] = useState<Record<string, number> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (targetMonth: string | null) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const query = targetMonth ? `?month=${encodeURIComponent(targetMonth)}` : "";
      const res = await fetch(withBase(`/api/stats/calendar${query}`), {
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

  // 磨耳朵时长（最近 35 天）单独取一次，失败不影响打卡主视图
  useEffect(() => {
    let cancelled = false;

    const loadListening = async () => {
      try {
        const res = await fetch(withBase("/api/listening/time"), { cache: "no-store" });
        if (!res.ok) return;
        const payload: unknown = await res.json().catch(() => null);
        if (cancelled || !payload || typeof payload !== "object") return;
        const days = (payload as { days?: unknown }).days;
        if (!Array.isArray(days)) return;

        const map: Record<string, number> = {};
        for (const item of days) {
          if (!item || typeof item !== "object") continue;
          const date = (item as { date?: unknown }).date;
          const seconds = (item as { seconds?: unknown }).seconds;
          if (typeof date === "string" && typeof seconds === "number" && seconds > 0) {
            map[date] = seconds;
          }
        }
        setListeningDays(map);
      } catch {
        // 静默：仅缺少磨耳朵一行
      }
    };

    void loadListening();
    return () => {
      cancelled = true;
    };
  }, []);

  const calendar = useMemo(() => buildCalendar(data?.month ?? ""), [data?.month]);
  const dayStats = data?.days;

  // 本月磨耳朵总秒数（满 35 天窗口内可覆盖当月）
  const monthListeningSeconds = useMemo(() => {
    if (!listeningDays || !data) return 0;
    const prefix = `${data.month}-`;
    return Object.entries(listeningDays).reduce(
      (sum, [key, seconds]) => (key.startsWith(prefix) ? sum + seconds : sum),
      0,
    );
  }, [listeningDays, data]);

  const selectedStat = selectedKey ? dayStats?.[selectedKey] : undefined;
  const selectedListening = selectedKey ? (listeningDays?.[selectedKey] ?? 0) : 0;

  /** 今日已获得的积分（用于打卡卡片上的小人下方展示） */
  const todayPoints = data?.today ? (dayStats?.[data.today]?.points ?? 0) : 0;

  const goMonth = (delta: number) => {
    if (!data) return;
    setSelectedKey(null);
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <div className="flex flex-col items-center rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 shadow-sm">
            <KidArt className="h-14 w-auto anim-float" />
            <p className="mt-0.5 text-[11px] leading-none text-[var(--muted)]">今日获得</p>
            <p className="mt-0.5 text-sm font-medium leading-none text-[var(--accent)]">
              +{fmt(todayPoints)} 积分
            </p>
          </div>
          <span>
            本月 <span className="font-medium text-[var(--ink)]">{fmt(data?.monthDays)}</span>{" "}
            天 ·{" "}
            <span className="font-medium text-[var(--ink)]">{fmt(data?.monthWords)}</span> 词 ·{" "}
            <span className="font-medium text-[var(--ink)]">{fmt(data?.monthPoints)}</span> 分
          </span>
          <PointsBadge total={data?.totalPoints} rules={data?.rules} />
          <span className="badge">连续 {fmt(data?.streak)} 天</span>
          <span className="badge" title="本月磨耳朵累计时长">
            🎧 本月磨耳朵{" "}
            {listeningDays === null ? "—" : Math.round(monthListeningSeconds / 60)} 分钟
          </span>
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
          <>
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
                    listeningSeconds={listeningDays?.[cell.key] ?? 0}
                    isToday={data.today === cell.key}
                    isSelected={selectedKey === cell.key}
                    onSelect={() =>
                      setSelectedKey((current) => (current === cell.key ? null : cell.key))
                    }
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
            <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-[var(--line)] pt-1 text-[11px] text-[var(--muted)]">
              {selectedKey ? (
                <>
                  <span className="font-medium text-[var(--ink)]">
                    {Number(selectedKey.slice(-2))} 日详情
                  </span>
                  <span>
                    听写{" "}
                    <span className="font-medium text-[var(--ink)]">
                      {selectedStat?.words ?? 0}
                    </span>{" "}
                    词 · 正确{" "}
                    <span className="font-medium text-[var(--ink)]">
                      {selectedStat?.correct ?? 0}
                    </span>{" "}
                    词 ·{" "}
                    <span className="font-medium text-[var(--ink)]">
                      {selectedStat?.points ?? 0}
                    </span>{" "}
                    分
                  </span>
                  <span>
                    🎧 磨耳朵{" "}
                    <span className="font-medium text-[var(--ink)]">
                      {selectedListening > 0 ? fullListening(selectedListening) : "—"}
                    </span>
                  </span>
                </>
              ) : (
                <span>点击日期查看当天详情</span>
              )}
            </div>
          </>
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
          本月 <span className="font-medium text-[var(--ink)]">{fmt(data?.monthPoints)}</span> 分 ·
          磨耳朵{" "}
          <span className="font-medium text-[var(--ink)]">
            {listeningDays === null ? "—" : Math.round(monthListeningSeconds / 60)}
          </span>{" "}
          分钟
        </p>
        <p className="text-[11px]">把鼠标移到「累计积分」上可查看积分规则</p>
        <p className="flex items-center gap-2">
          <PointsBadge total={data?.totalPoints} rules={data?.rules} label="累计积分" />
          <span className="badge">连续打卡 {fmt(data?.streak)} 天</span>
        </p>
      </div>
    </div>
  );
}
