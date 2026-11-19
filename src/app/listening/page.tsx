"use client";

import { useMemo, useState } from "react";
import {
  LISTENING_MATERIALS,
  bilibiliEmbedUrl,
  bilibiliWatchUrl,
  pickDailyMaterial,
  pickDailyPart,
} from "@/lib/listening/materials";

function todayLabel(date = new Date()): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export default function ListeningPage() {
  const daily = useMemo(() => pickDailyMaterial(), []);
  const suggestedPart = useMemo(() => pickDailyPart(daily.pages), [daily.pages]);
  const [part, setPart] = useState(suggestedPart);
  const material = LISTENING_MATERIALS[0] ?? daily;

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
