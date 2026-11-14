"use client";

import { useState } from "react";

type FileResult = {
  created: number;
  updated: number;
  total: number;
  errors: string[];
  listName: string;
};

export default function ImportPage() {
  const [listName, setListName] = useState("导入词表");
  const [file, setFile] = useState<File | null>(null);
  const [fileResult, setFileResult] = useState<FileResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);

  async function submitFile(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setFileError("请选择 CSV 或 Excel（.xlsx / .xls）文件");
      return;
    }
    setFileBusy(true);
    setFileError(null);
    setFileResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("listName", listName);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setFileError(data.error || "导入失败");
        return;
      }
      setFileResult(data);
    } catch {
      setFileError("网络错误");
    } finally {
      setFileBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0">
        <h1 className="font-display text-xl">导入词表</h1>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
          支持 CSV / Excel 批量导入。固定列序：
          <code className="ml-1 rounded bg-[var(--chip)] px-1 text-[11px]">
            序号,单词,音标,词性,中文释义,例句,相关词组,近义词,反义词
          </code>
          （<strong>首行表头不导入</strong>、<strong>首列序号不导入</strong>；近/反义词写入 related）。同词<strong>覆盖</strong>。
        </p>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <form onSubmit={submitFile} className="panel space-y-2 p-3">
            <h2 className="font-display text-lg">CSV / Excel 批量导入</h2>
            <div>
              <label className="label text-xs">词表名称</label>
              <input
                className="field"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
              />
            </div>
            <div>
              <label className="label text-xs">文件（.csv / .xlsx / .xls）</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="block w-full text-xs"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn-primary" disabled={fileBusy}>
                {fileBusy ? "导入中…" : "开始导入"}
              </button>
              <a className="btn-secondary" href="/api/import/template">
                下载 Excel 模板
              </a>
              <a className="text-xs text-[var(--teal)]" href="/templates/words-import.xlsx">
                静态模板链接
              </a>
            </div>
          </form>

          {fileError && (
            <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] rounded-md px-3 py-2">
              {fileError}
            </p>
          )}
          {fileResult && (
            <div className="panel space-y-1 p-3">
              <p className="text-sm font-medium">导入完成 · {fileResult.listName}</p>
              <p className="text-xs text-[var(--muted)]">
                共 {fileResult.total} 条：新建 {fileResult.created}，覆盖更新 {fileResult.updated}
              </p>
              {fileResult.errors?.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-[var(--accent)]">
                  {fileResult.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="panel space-y-2 p-3 text-xs text-[var(--muted)]">
            <p className="font-medium text-[var(--ink)]">样例与考纲词表</p>
            <p>
              CSV：<code className="bg-[var(--chip)] px-1 rounded">samples/words.sample.csv</code>
              ；Excel：
              <code className="bg-[var(--chip)] px-1 rounded">samples/words.sample.xlsx</code>
            </p>
            <p>
              上海初中考纲（2026 整理版）：
              <code className="bg-[var(--chip)] px-1 rounded">samples/shanghai-zhongkao-2026.csv</code>
              ，来源见{" "}
              <code className="bg-[var(--chip)] px-1 rounded">samples/SOURCES.md</code>
              。也可 <code className="bg-[var(--chip)] px-1 rounded">npm run db:seed</code>。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
