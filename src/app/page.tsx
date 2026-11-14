"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type QueueResp = {
  date: string;
  goalN: number;
  items: { entryId: string; word: string; reason: string; mode: string }[];
  reviewDay: boolean;
  clozeEnabled: boolean;
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
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--ink)] text-[var(--paper)] px-6 py-10 md:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(600px 280px at 80% 20%, #2a8f7f, transparent), radial-gradient(400px 220px at 10% 90%, #c45c26aa, transparent)",
          }}
        />
        <div className="relative space-y-4 max-w-xl">
          <p className="font-display text-4xl md:text-5xl tracking-tight">CrazyWords</p>
          <p className="text-lg text-white/85 leading-relaxed">
            导入自有词表，设定今日目标，用麦克风完成双模式听写（释义→拼写 / 单词→中文）。
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
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

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="panel p-5">
          <p className="label">词库</p>
          <p className="font-display text-3xl">{entryCount}</p>
          <p className="text-sm text-[var(--muted)] mt-1">条词条</p>
        </div>
        <div className="panel p-5">
          <p className="label">今日队列</p>
          <p className="font-display text-3xl">{queue?.items.length ?? "—"}</p>
          <p className="text-sm text-[var(--muted)] mt-1">
            目标 {me?.dailyGoalDefault ?? "—"}
            {queue?.reviewDay ? " · 复习日" : ""}
          </p>
        </div>
        <div className="panel p-5">
          <p className="label">活跃错词</p>
          <p className="font-display text-3xl">{wrongCount}</p>
          <p className="text-sm text-[var(--muted)] mt-1">错词本</p>
        </div>
      </section>

      <section className="panel p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl">今日队列预览</h2>
          <Link href="/dictation" className="text-sm text-[var(--teal)]">
            去听写 →
          </Link>
        </div>
        {!queue ? (
          <p className="text-[var(--muted)] text-sm">加载中…</p>
        ) : queue.items.length === 0 ? (
          <p className="text-[var(--muted)] text-sm">
            队列为空。请先到「导入」上传 CSV，或确认词条有中文释义。
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {queue.items.slice(0, 8).map((item) => (
              <li key={item.entryId} className="py-2.5 flex items-center justify-between gap-3">
                <span className="font-medium">{item.word}</span>
                <span className="flex gap-2">
                  <span className="badge">
                    {item.reason === "due" ? "到期" : item.reason === "wrong" ? "错词" : "新词"}
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
