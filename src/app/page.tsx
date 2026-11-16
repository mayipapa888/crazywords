"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type QueueResp = {
  date: string;
  goalN: number;
  items: { entryId: string; word: string; reason: string; mode: string }[];
  reviewDay: boolean;
  clozeEnabled: boolean;
  tomorrowDueCount?: number;
};

type Me = {
  dailyGoalDefault: number;
  clozeEnabled: boolean;
};

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [queue, setQueue] = useState<QueueResp | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/queue/today").then((r) => r.json()),
      fetch("/api/entries").then((r) => r.json()),
      fetch("/api/wrong-book").then((r) => r.json()),
    ]).then(([m, q, e, w]) => {
      setMe(m);
      setQueue(q);
      setEntryCount(e.entries?.length || 0);
      setWrongCount(w.items?.length || 0);
    });
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <section className="relative shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--ink)] px-5 py-5 text-[var(--paper)] md:px-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(600px 280px at 80% 20%, #2a8f7f, transparent), radial-gradient(400px 220px at 10% 90%, #c45c26aa, transparent)",
          }}
        />
        <div className="relative max-w-xl space-y-2">
          <p className="font-display text-3xl tracking-tight md:text-4xl">CrazyWords</p>
          <p className="text-base leading-relaxed text-white/85">
            导入自有词表，设定今日目标，用麦克风完成双模式听写（释义→拼写 / 单词→中文）。
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/dictation" className="btn-accent">
              开始今日听写
            </Link>
            <Link
              href="/import"
              className="btn-secondary border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              导入 CSV
            </Link>
          </div>
        </div>
      </section>

      <section className="grid shrink-0 gap-3 sm:grid-cols-3">
        <div className="panel p-3">
          <p className="label">词库</p>
          <p className="font-display text-2xl">{entryCount}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">条词条</p>
        </div>
        <div className="panel p-3">
          <p className="label">今日队列</p>
          <p className="font-display text-2xl">{queue?.items.length ?? "—"}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            目标 {me?.dailyGoalDefault ?? "—"}
            {queue?.reviewDay ? " · 复习日" : ""}
          </p>
        </div>
        <div className="panel p-3">
          <p className="label">活跃错词</p>
          <p className="font-display text-2xl">{wrongCount}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">错词本</p>
        </div>
      </section>

      <section className="panel no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="font-display text-lg">今日需记忆（艾宾浩斯）</h2>
            <span className="text-xs text-[var(--muted)]">
              {queue
                ? `明日复习 ${queue.tomorrowDueCount ?? 0} 个`
                : "按 1·2·4·7·15·30·60 天曲线安排"}
            </span>
          </div>
          <Link href="/dictation" className="shrink-0 text-sm text-[var(--teal)]">
            去听写 →
          </Link>
        </div>
        {!queue ? (
          <p className="text-sm text-[var(--muted)]">加载中…</p>
        ) : queue.items.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            队列为空。请先到「导入」上传 CSV，或确认词条有中文释义。
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {queue.items.slice(0, 8).map((item) => (
              <li key={item.entryId} className="flex items-center justify-between gap-3 py-1.5">
                <span className="font-medium">{item.word}</span>
                <span className="flex gap-2">
                  <span className="badge">
                    {item.reason === "due" ? "到期复习" : item.reason === "wrong" ? "错词" : "新词"}
                  </span>
                  <span className="badge">
                    {item.mode === "gloss" ? "释义→拼写" : "单词→中文"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
