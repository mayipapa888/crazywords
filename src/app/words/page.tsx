"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string[];
  related: string[];
  incomplete: boolean;
  incompleteReasons: string[];
};

export default function WordsPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 12;
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = entries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function load(query = q) {
    const res = await fetch(`/api/entries${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    const data = await res.json();
    setEntries(data.entries || []);
    setPage(0);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!editing) return;
    const res = await fetch(`/api/entries/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: editing.word,
        glossZh: editing.glossZh,
        ipa: editing.ipa,
        pos: editing.pos,
        example: editing.example,
        phrases: editing.phrases,
        related: editing.related,
      }),
    });
    if (!res.ok) {
      setMsg("保存失败");
      return;
    }
    setEditing(null);
    setMsg("已保存");
    load();
  }

  async function remove(id: string) {
    if (!confirm("确认删除该词条？")) return;
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">词表</h1>
          <p className="text-xs text-[var(--muted)]">
            共 {entries.length} 条 · 第 {safePage + 1}/{pageCount} 页
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="field w-56"
            placeholder="搜索单词 / 释义"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <button type="button" className="btn-secondary" onClick={() => load()}>
            搜索
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-[var(--teal)]">{msg}</p>}

      <div className="panel min-h-0 flex-1 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--chip)] text-left text-[var(--muted)]">
            <tr>
              <th className="px-3 py-1.5 font-medium">单词</th>
              <th className="px-3 py-1.5 font-medium">释义</th>
              <th className="hidden px-3 py-1.5 font-medium md:table-cell">音标</th>
              <th className="px-3 py-1.5 font-medium">状态</th>
              <th className="px-3 py-1.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {pageRows.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-1.5 font-medium">
                  {e.word}
                  {e.pos && <span className="badge ml-2">{e.pos}</span>}
                </td>
                <td className="max-w-[16rem] truncate px-3 py-1.5 text-[var(--muted)]">
                  {e.glossZh || "—"}
                </td>
                <td className="hidden px-3 py-1.5 text-[var(--muted)] md:table-cell">
                  {e.ipa || "—"}
                </td>
                <td className="px-3 py-1.5">
                  {e.incomplete ? (
                    <span className="badge-warn badge" title={e.incompleteReasons.join("、")}>
                      资料不全
                    </span>
                  ) : (
                    <span className="badge-ok badge">可听写</span>
                  )}
                </td>
                <td className="space-x-2 px-3 py-1.5">
                  <button type="button" className="text-[var(--teal)]" onClick={() => setEditing(e)}>
                    编辑
                  </button>
                  <button type="button" className="text-[var(--danger)]" onClick={() => remove(e.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[var(--muted)]">
                  暂无词条，请先导入 CSV。
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
          disabled={safePage <= 0}
          onClick={() => setPage(safePage - 1)}
        >
          上一页
        </button>
        <p className="text-xs text-[var(--muted)]">
          {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, entries.length)} / {entries.length}
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

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="panel w-full max-w-lg p-6 space-y-3">
            <h2 className="font-display text-xl">编辑词条</h2>
            {(
              [
                ["word", "单词"],
                ["glossZh", "中文释义"],
                ["ipa", "音标"],
                ["pos", "词性"],
                ["example", "例句"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  className="field"
                  value={(editing[key] as string) || ""}
                  onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                取消
              </button>
              <button type="button" className="btn-primary" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
