"use client";

import { useEffect, useState } from "react";

type Source = "dictation" | "list";

type WordbookItem = {
  entryId: string;
  word: string;
  ipa: string | null;
  glossZh: string | null;
  pos: string | null;
  example: string | null;
  sources: Source[];
  studyCount: number;
  lastStudiedAt: string | null;
  addedAt: string;
};

type WordbookResponse = {
  total: number;
  page: number;
  pageSize: number;
  items: WordbookItem[];
  error?: string;
};

const PAGE_SIZE = 15;

function formatMonthDay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

function studyLabel(item: WordbookItem): string {
  if (item.studyCount > 0) {
    return `听写 ${item.studyCount} 次 · 最近 ${formatMonthDay(item.lastStudiedAt)}`;
  }
  return `加入 ${formatMonthDay(item.addedAt)}`;
}

export default function WordbookPage() {
  const [items, setItems] = useState<WordbookItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });
        if (query) params.set("q", query);

        const res = await fetch(`/api/wordbook?${params.toString()}`);
        const data = (await res.json()) as WordbookResponse;
        if (!res.ok) throw new Error(data.error || "加载失败");
        if (cancelled) return;

        setItems(data.items);
        setTotal(data.total);
        setPage(data.page);
      } catch (e) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, query, reloadToken]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isEmpty = !loading && !error && items.length === 0;

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(input.trim());
    setReloadToken((token) => token + 1);
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">我的单词本</h1>
          <p className="text-xs text-[var(--muted)]">
            共 {total} 个单词 · 听写过的与词库里的自动去重汇总
            {loading && <span className="ml-2">加载中…</span>}
          </p>
        </div>
        <form className="flex gap-2" onSubmit={search}>
          <input
            className="field w-56"
            placeholder="搜索单词 / 释义"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={loading}>
            搜索
          </button>
        </form>
      </div>

      <div className="panel min-h-0 flex-1 overflow-hidden">
        <table className="w-full text-sm" aria-busy={loading}>
          <thead className="bg-[var(--chip)] text-left text-[var(--muted)]">
            <tr>
              <th className="px-3 py-1.5 font-medium">单词</th>
              <th className="hidden px-3 py-1.5 font-medium sm:table-cell">音标</th>
              <th className="px-3 py-1.5 font-medium">释义</th>
              <th className="px-3 py-1.5 font-medium">来源</th>
              <th className="px-3 py-1.5 font-medium">次数 / 时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {items.map((item) => (
              <tr
                key={item.entryId}
                title={item.example ? `例句：${item.example}` : undefined}
                className="hover:bg-[var(--chip)]/50"
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-medium">
                  {item.word}
                  {item.pos && <span className="badge ml-2">{item.pos}</span>}
                </td>
                <td className="hidden px-3 py-1.5 text-[var(--muted)] sm:table-cell">
                  {item.ipa || "—"}
                </td>
                <td className="max-w-[18rem] truncate px-3 py-1.5 text-[var(--muted)]">
                  {item.glossZh || "—"}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-1">
                    {item.sources.includes("dictation") && (
                      <span className="badge-ok badge">听写</span>
                    )}
                    {item.sources.includes("list") && <span className="badge">词库</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-[var(--muted)]">
                  {studyLabel(item)}
                </td>
              </tr>
            ))}
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-[var(--muted)]">
                  加载中…
                </td>
              </tr>
            )}
            {isEmpty && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-[var(--muted)]">
                  还没有单词记录，去听写或导入词库
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-[var(--danger)]">
                  {error}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={page <= 1 || loading}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          上一页
        </button>
        <p className="text-xs text-[var(--muted)]">
          第 {page}/{pageCount} 页 · 共 {total} 条
        </p>
        <button
          type="button"
          className="btn-secondary"
          disabled={page >= pageCount || loading}
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
