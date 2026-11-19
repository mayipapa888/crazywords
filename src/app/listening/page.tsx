"use client";

import { useMemo, useState } from "react";
import {
  LISTENING_MATERIALS,
  bilibiliEmbedUrl,
  bilibiliWatchUrl,
  pickDailyMaterial,
  type ListeningMaterial,
} from "@/lib/listening/materials";

function todayLabel(date = new Date()): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export default function ListeningPage() {
  const daily = useMemo(() => pickDailyMaterial(), []);
  const dailyIndex = LISTENING_MATERIALS.findIndex((item) => item.bvid === daily.bvid);
  const [activeIndex, setActiveIndex] = useState(dailyIndex >= 0 ? dailyIndex : 0);
  const active: ListeningMaterial = LISTENING_MATERIALS[activeIndex] ?? daily;
  const isDaily = active.bvid === daily.bvid;

  function step(delta: number) {
    const total = LISTENING_MATERIALS.length;
    setActiveIndex((current) => (current + delta + total) % total);
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl">
            磨耳朵
            <span className="badge ml-2 align-middle">{todayLabel()} 推荐</span>
          </h1>
          <p className="truncate text-xs text-[var(--muted)]">
            每天一条初中级听力素材 · 全部为 B 站官方播放器内嵌，版权归原作者
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => step(-1)}>
            ← 上一条
          </button>
          <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => step(1)}>
            下一条 →
          </button>
          <a
            href={bilibiliWatchUrl(active.bvid)}
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
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold">
            {isDaily && <span className="mr-1 text-[var(--accent)]">今日</span>}
            {active.title}
          </h2>
          <span className="badge">{active.subtitle}</span>
          <span className="badge">{active.level}</span>
          <span className="badge">
            {active.minutes} 分钟{active.pages > 1 ? ` · ${active.pages} P` : ""}
          </span>
        </div>

        <div className="relative min-h-0 flex-1 bg-black">
          <iframe
            key={active.bvid}
            src={bilibiliEmbedUrl(active.bvid)}
            title={active.title}
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
            {active.up主} · {active.note}
          </p>
        </div>
      </section>

      <section className="panel shrink-0 px-3 py-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {LISTENING_MATERIALS.map((item, index) => {
            const isActive = index === activeIndex;
            const isToday = item.bvid === daily.bvid;
            return (
              <button
                key={item.bvid}
                type="button"
                onClick={() => setActiveIndex(index)}
                title={`${item.title}（${item.up主}）`}
                className={`flex w-44 shrink-0 flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] hover:border-[var(--accent)]"
                }`}
              >
                <span className="line-clamp-2 text-xs font-medium leading-snug">{item.title}</span>
                <span className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                  {isToday && <span className="text-[var(--accent)]">今日 ·</span>}
                  {item.minutes} 分钟
                </span>
                <span className="flex flex-wrap gap-1">
                  {item.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="badge text-[10px]">
                      {tag}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
