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

export default function WrongBookPage() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    fetch("/api/wrong-book")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []));
  }, []);

  const kindLabel = (k: string) =>
    k === "spelling" ? "拼写" : k === "pronunciation" ? "发音" : "拼写+发音";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">错词本</h1>
        <p className="text-[var(--muted)] mt-1">
          拼写或发音任失败即入册；连续正确 2 次后移出（SRS 仍保留）。
        </p>
      </div>

      <div className="panel overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-lg">
                  {item.entry.word}
                  {item.entry.ipa && (
                    <span className="text-sm text-[var(--muted)] ml-2">{item.entry.ipa}</span>
                  )}
                </p>
                <p className="text-sm text-[var(--muted)]">{item.entry.glossZh}</p>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="badge">错 {item.wrongCount} 次</span>
                <span className="badge-warn badge">{kindLabel(item.lastWrongKinds)}</span>
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-10 text-center text-[var(--muted)]">暂无活跃错词</li>
          )}
        </ul>
      </div>
    </div>
  );
}
