"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  wrongCount: number;
  lastWrongAt: string;
  lastWrongKinds: string;
  consecutiveOk: number;
  entry: {
    word: string;
    glossZh: string | null;
    ipa: string | null;
    pos: string | null;
  };
};

const PAGE_SIZE = 12;

export default function WrongBookPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch("/api/wrong-book")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []));
  }, []);

  const kindLabel = (k: string) =>
    k === "spelling" ? "拼写" : k === "pronunciation" ? "发音" : "拼写+发音";

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0">
        <h1 className="font-display text-xl">错词本</h1>
        <p className="text-xs text-[var(--muted)]">
          共 {items.length} 条 · 第 {safePage + 1}/{pageCount} 页 ·
          拼写或发音任失败即入册，连续正确 2 次后移出（SRS 仍保留）。
        </p>
      </div>

      <div className="panel min-h-0 flex-1 overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {pageRows.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-base font-medium">
                  {item.entry.word}
                  {item.entry.ipa && (
                    <span className="ml-2 text-xs text-[var(--muted)]">{item.entry.ipa}</span>
                  )}
                </p>
                <p className="truncate text-xs text-[var(--muted)]">{item.entry.glossZh}</p>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="badge">错 {item.wrongCount} 次</span>
                <span className="badge-warn badge">{kindLabel(item.lastWrongKinds)}</span>
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-10 text-center text-[var(--muted)]">暂无活跃错词</li>
          )}
        </ul>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={safePage <= 0}
          onClick={() => setPage(safePage - 1)}
        >
          上一页
        </button>
        <p className="text-xs text-[var(--muted)]">
          {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, items.length)} / {items.length}
        </p>
        <button
          type="button"
          className="btn-secondary"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage(safePage + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
