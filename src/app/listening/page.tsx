"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LISTENING_MATERIALS,
  bilibiliEmbedUrl,
  bilibiliWatchUrl,
  pickDailyMaterial,
  pickDailyPart,
} from "@/lib/listening/materials";

/** 上报间隔：每 30 秒累计一次 30 秒收听时长 */
const TICK_MS = 30_000;
const STEP_SECONDS = 30;
/** 播放位置累计间隔与落盘间隔 */
const POS_TICK_MS = 5_000;
const POS_SAVE_MS = 15_000;
const LAST_KEY = "cw:listening:last";

type LastState = {
  bvid: string;
  page: number;
  posSeconds: number;
  updatedAt: string;
};

function readLast(): LastState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastState>;
    if (typeof parsed.page !== "number" || !Number.isFinite(parsed.page)) return null;
    return {
      bvid: typeof parsed.bvid === "string" ? parsed.bvid : "",
      page: Math.max(1, Math.floor(parsed.page)),
      posSeconds:
        typeof parsed.posSeconds === "number" && parsed.posSeconds > 0
          ? Math.floor(parsed.posSeconds)
          : 0,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

function writeLast(state: LastState) {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式/配额满时忽略，不影响播放
  }
}

function todayLabel(date = new Date()): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 12 分 30 秒 / 45 秒 / 8 分 */
function formatListening(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`;
}

/** 12:30 形式的时间点 */
function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ListeningPage() {
  const daily = useMemo(() => pickDailyMaterial(), []);
  const suggestedPart = useMemo(() => pickDailyPart(daily.pages), [daily.pages]);
  const material = LISTENING_MATERIALS[0] ?? daily;

  const [part, setPart] = useState(() => Math.min(suggestedPart, material.pages));
  /** 仅在首次恢复上次进度时非 0，作为播放器起播秒数 */
  const [startAt, setStartAt] = useState(0);
  /** 恢复出的上次位置，用于顶部提示 */
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const posRef = useRef(0);
  const restoredRef = useRef(false);

  /** 今日已听秒数；null 表示尚未取到 */
  const [todaySeconds, setTodaySeconds] = useState<number | null>(null);
  /** 同一时刻只允许一次上报，避免网络慢时请求堆积 */
  const inFlightRef = useRef(false);

  // 进入页面：恢复上次的集数与播放位置
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const last = readLast();
    if (!last) return;
    if (last.bvid && last.bvid !== material.bvid) return;
    const page = Math.min(Math.max(1, last.page), material.pages);
    setPart(page);
    posRef.current = last.posSeconds;
    if (last.posSeconds > 0) {
      setStartAt(last.posSeconds);
      setResumeNote(`上次听到第 ${page} 集 ${formatClock(last.posSeconds)}`);
    } else {
      setResumeNote(`上次听到第 ${page} 集`);
    }
  }, [material.bvid, material.pages]);

  // 进入页面先取一次今日累计
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/listening/time", { cache: "no-store" });
        if (!res.ok) return;
        const payload: unknown = await res.json().catch(() => null);
        if (cancelled || !payload || typeof payload !== "object") return;
        const today = (payload as { today?: unknown }).today;
        if (typeof today === "number" && Number.isFinite(today)) {
          setTodaySeconds(today);
        }
      } catch {
        // 读取失败不打扰播放，标签保持「…」
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 计时：仅当页面可见时每 30 秒上报 30 秒；隐藏期间不计时
  useEffect(() => {
    let disposed = false;

    const report = async () => {
      if (disposed || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/listening/time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds: STEP_SECONDS }),
          keepalive: true,
        });
        if (!res.ok) return;
        const payload: unknown = await res.json().catch(() => null);
        if (disposed || !payload || typeof payload !== "object") return;
        const total = (payload as { seconds?: unknown }).seconds;
        if (typeof total === "number" && Number.isFinite(total)) {
          setTodaySeconds(total);
        }
      } catch {
        // 本轮失败直接跳过，不重试堆叠，等下一个 30 秒再上报
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void report();
      }
    }, TICK_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  /** 把当前集数与位置落盘 */
  const persist = useCallback(() => {
    writeLast({
      bvid: material.bvid,
      page: part,
      posSeconds: posRef.current,
      updatedAt: new Date().toISOString(),
    });
  }, [material.bvid, part]);

  // 播放位置：可见时按 5 秒累计（跨域拿不到 iframe 真实进度，用停留时长近似）
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") posRef.current += POS_TICK_MS / 1000;
    }, POS_TICK_MS);
    const saveTimer = window.setInterval(persist, POS_SAVE_MS);

    const onHide = () => persist();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(saveTimer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      persist();
    };
  }, [persist]);

  /** 手动切集：位置清零，不再沿用上次起播点 */
  const changePart = useCallback((next: number) => {
    posRef.current = 0;
    setStartAt(0);
    setResumeNote(null);
    setPart(next);
  }, []);

  function go(delta: number) {
    const next = part + delta;
    if (next < 1) changePart(material.pages);
    else if (next > material.pages) changePart(1);
    else changePart(next);
  }

  const embedSrc =
    bilibiliEmbedUrl(material.bvid, part) + (startAt > 0 ? `&t=${startAt}` : "");

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl">
            磨耳朵
            <span className="badge ml-2 align-middle">
              {todayLabel()} 推荐第 {suggestedPart} 集
            </span>
          </h1>
          <p className="truncate text-xs text-[var(--muted)]">
            每天一集初中听力 9000 句 · B 站官方播放器内嵌，版权归原作者
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => go(-1)}>
            ← 上一集
          </button>
          <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => go(1)}>
            下一集 →
          </button>
          <a
            href={bilibiliWatchUrl(material.bvid, part)}
            target="_blank"
            rel="noreferrer"
            className="btn-primary py-1.5 text-xs"
          >
            在 B 站打开
          </a>
        </div>
      </header>

      <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{material.title}</h2>
          {resumeNote && <span className="badge shrink-0">{resumeNote}</span>}
          <span
            className="badge shrink-0"
            title="本页可见时每 30 秒累计一次；切到后台自动暂停"
            aria-live="polite"
          >
            🎧 今日已听 {todaySeconds === null ? "…" : formatListening(todaySeconds)}
          </span>
          <label className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted)]">
            第
            <select
              value={part}
              onChange={(event) => changePart(Number(event.target.value))}
              className="rounded border border-[var(--line)] bg-[var(--paper)] px-1 py-0.5 text-xs text-[var(--ink)]"
              aria-label="选择集数"
            >
              {Array.from({ length: material.pages }, (_, index) => index + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            集
          </label>
          <span className="badge">{material.subtitle}</span>
          <span className="badge">
            共 {material.pages} 集 · {material.minutes} 分钟
          </span>
          {part === suggestedPart && <span className="badge text-[var(--accent)]">今日</span>}
        </div>

        <div className="relative min-h-0 flex-1 bg-black">
          <iframe
            key={`${material.bvid}-${part}-${startAt}`}
            src={embedSrc}
            title={`${material.title} 第 ${part} 集`}
            className="h-full w-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            frameBorder={0}
          />
        </div>

        <div className="no-scrollbar shrink-0 overflow-y-auto border-t border-[var(--line)] px-3 py-2">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            <span className="text-[var(--ink)]">UP 主：</span>
            {material.up主} · {material.note}
          </p>
        </div>
      </section>
    </div>
  );
}
