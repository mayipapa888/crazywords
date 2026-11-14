"use client";

import { useState } from "react";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [listName, setListName] = useState("导入词表");
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    total: number;
    errors: string[];
    listName: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("请选择 CSV 文件");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("listName", listName);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "导入失败");
        return;
      }
      setResult(data);
    } catch {
      setError("网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl">导入词表</h1>
        <p className="text-[var(--muted)] mt-1">
          CSV 表头：<code className="text-xs bg-[var(--chip)] px-1 rounded">word,gloss_zh,ipa,pos,example,phrases,related</code>
          。同词<strong>覆盖</strong>已有条目（保留 SRS / 错词本关联）。
        </p>
      </div>

      <form onSubmit={submit} className="panel p-6 space-y-4">
        <div>
          <label className="label">词表名称</label>
          <input
            className="field"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">CSV 文件</label>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "导入中…" : "开始导入"}
        </button>
      </form>

      {error && (
        <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {result && (
        <div className="panel p-5 space-y-2">
          <p className="font-medium">导入完成 · {result.listName}</p>
          <p className="text-sm text-[var(--muted)]">
            共 {result.total} 条：新建 {result.created}，覆盖更新 {result.updated}
          </p>
          {result.errors?.length > 0 && (
            <ul className="text-sm text-[var(--accent)] list-disc pl-5">
              {result.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="panel p-5 text-sm text-[var(--muted)] space-y-2">
        <p className="font-medium text-[var(--ink)]">样例文件</p>
        <p>
          仓库内 <code className="bg-[var(--chip)] px-1 rounded">samples/words.sample.csv</code>
        </p>
        <pre className="bg-[var(--chip)] rounded-md p-3 overflow-x-auto text-xs text-[var(--ink)]">{`word,gloss_zh,ipa,pos,example,phrases,related
abandon,放弃；遗弃,/əˈbændən/,v.,They had to abandon the project.,abandon hope,desert|forsake`}</pre>
      </div>
    </div>
  );
}
