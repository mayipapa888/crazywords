"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export default function ListeningPage() {
  const daily = useMemo(() => pickDailyMaterial(), []);
  const suggestedPart = useMemo(() => pickDailyPart(daily.pages), [daily.pages]);
  const [part, setPart] = useState(suggestedPart);
  const material = LISTENING_MATERIALS[0] ?? daily;

  /** 今日已听秒数；null 表示尚未取到 */
  const [todaySeconds, setTodaySeconds] = useState<number | null>(null);
  /** 同一时刻只允许一次上报，避免网络慢时请求堆积 */
  const inFlightRef = useRef(false);

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

  function go(delta: number) {
    setPart((current) => {
      const next = current + delta;
      if (next < 1) return material.pages;
      if (next > material.pages) return 1;
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl">
            磨耳朵
            <span className="badge ml-2 align-middle">{todayLabel()} 推荐第 {suggestedPart} 集</span>
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
              onChange={(event) => setPart(Number(event.target.value))}
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
            key={`${material.bvid}-${part}`}
            src={bilibiliEmbedUrl(material.bvid, part)}
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
