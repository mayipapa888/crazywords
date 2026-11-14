"use client";

import { useCallback, useEffect, useState } from "react";
import { MicRecorder } from "@/lib/mic";

type FileResult = {
  created: number;
  updated: number;
  total: number;
  errors: string[];
  listName: string;
};

type ManualForm = {
  word: string;
  glossZh: string;
  ipa: string;
  pos: string;
  example: string;
  phrases: string;
  related: string;
};

const emptyForm = (): ManualForm => ({
  word: "",
  glossZh: "",
  ipa: "",
  pos: "",
  example: "",
  phrases: "",
  related: "",
});

export default function ImportPage() {
  const [listName, setListName] = useState("导入词表");
  const [file, setFile] = useState<File | null>(null);
  const [fileResult, setFileResult] = useState<FileResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);

  const [form, setForm] = useState<ManualForm>(emptyForm);
  const [manualListName, setManualListName] = useState("手工导入");
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorder] = useState(() => new MicRecorder());

  useEffect(() => () => recorder.cleanup(), [recorder]);

  const setField = useCallback(<K extends keyof ManualForm>(key: K, value: ManualForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

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

  async function enrich(word = form.word) {
    const w = word.trim();
    if (!w) {
      setEnrichNote("请先填写或语音输入单词");
      return;
    }
    setManualBusy(true);
    setEnrichNote(null);
    setManualError(null);
    try {
      const res = await fetch(`/api/dict/enrich?word=${encodeURIComponent(w)}`);
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.error || "补全失败");
        return;
      }
      setForm((f) => ({
        ...f,
        word: data.word || f.word,
        glossZh: data.glossZh || f.glossZh,
        ipa: data.ipa || f.ipa,
        pos: data.pos || f.pos,
        example: data.example || f.example,
        related: data.related?.length ? data.related.join("|") : f.related,
      }));
      const warns = [...(data.warnings || [])];
      if (data.incomplete) {
        warns.push(`资料不全：${(data.incompleteReasons || []).join("、")}`);
      }
      if (data.sources?.length) warns.unshift(`来源：${data.sources.join(" + ")}`);
      setEnrichNote(warns.join(" · ") || "已补全");
    } catch {
      setManualError("补全请求失败");
    } finally {
      setManualBusy(false);
    }
  }

  async function toggleVoice() {
    setManualError(null);
    if (!recording) {
      try {
        await recorder.start();
        setRecording(true);
      } catch {
        setManualError("无法录音，请授权麦克风");
      }
      return;
    }
    setManualBusy(true);
    try {
      const blob = await recorder.stop();
      setRecording(false);
      const fd = new FormData();
      fd.append("audio", blob, "word.webm");
      // mock ASR 可用 text 作 hint；真阿里云忽略
      const res = await fetch("/api/speech/asr", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.error || "语音识别失败");
        return;
      }
      const lemma = String(data.text || "")
        .trim()
        .toLowerCase()
        .replace(/[^\w'-]/g, "");
      if (!lemma) {
        setManualError("未识别到英文单词");
        return;
      }
      setField("word", lemma);
      await enrich(lemma);
    } catch {
      setManualError("语音输入失败");
      setRecording(false);
    } finally {
      setManualBusy(false);
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!form.word.trim()) {
      setManualError("单词必填");
      return;
    }
    setManualBusy(true);
    setManualError(null);
    setManualMsg(null);
    try {
      const res = await fetch("/api/entries/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listName: manualListName,
          word: form.word.trim(),
          glossZh: form.glossZh,
          ipa: form.ipa,
          pos: form.pos,
          example: form.example,
          phrases: form.phrases,
          related: form.related,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.error || "保存失败");
        return;
      }
      const flag = data.overwritten ? "已覆盖同词" : "已新建";
      const incomplete = data.incomplete
        ? `（资料不全：${(data.incompleteReasons || []).join("、")}）`
        : "";
      setManualMsg(`${flag}：${form.word}${incomplete}`);
      setForm(emptyForm());
    } catch {
      setManualError("网络错误");
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0">
        <h1 className="font-display text-xl">导入词表</h1>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
          支持 CSV / Excel 批量导入、单条手工录入与语音输入。固定列序：
          <code className="ml-1 rounded bg-[var(--chip)] px-1 text-[11px]">
            序号,单词,音标,词性,中文释义,例句,相关词组,近义词,反义词
          </code>
          （<strong>首行表头不导入</strong>、<strong>首列序号不导入</strong>；近/反义词写入 related）。同词<strong>覆盖</strong>。
        </p>
      </div>

      <div className="no-scrollbar grid min-h-0 flex-1 gap-2 overflow-y-auto md:grid-cols-2 md:overflow-hidden">
        {/* 手工 / 语音 */}
        <section className="panel flex min-h-0 flex-col p-3">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg">手工 / 语音录入</h2>
            <button
              type="button"
              className={recording ? "btn-accent" : "btn-secondary"}
              disabled={manualBusy}
              onClick={toggleVoice}
            >
              {recording ? "停止并识别" : "语音输入单词"}
            </button>
          </div>
          <p className="mt-1 shrink-0 text-xs text-[var(--muted)]">
            语音走现有 ASR（英文）；识别后可自动补全释义等字段。无词典/翻译密钥时请手填。
          </p>
          <form onSubmit={submitManual} className="mt-2 flex min-h-0 flex-1 flex-col">
            <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              <div>
                <label className="label text-xs">目标词表名称</label>
                <input
                  className="field"
                  value={manualListName}
                  onChange={(e) => setManualListName(e.target.value)}
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label className="label text-xs">单词（必填）</label>
                  <input
                    className="field"
                    value={form.word}
                    onChange={(e) => setField("word", e.target.value)}
                    onBlur={() => form.word.trim() && enrich()}
                    placeholder="abandon"
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  disabled={manualBusy}
                  onClick={() => enrich()}
                >
                  自动补全
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["glossZh", "中文释义 gloss_zh"],
                    ["ipa", "音标"],
                    ["pos", "词性"],
                    ["example", "例句"],
                    ["phrases", "词组（| 分隔）"],
                    ["related", "相关词（| 分隔）"],
                  ] as const
                ).map(([key, label]) => (
                  <div
                    key={key}
                    className={key === "glossZh" || key === "example" ? "col-span-2" : ""}
                  >
                    <label className="label text-xs">{label}</label>
                    <input
                      className="field"
                      value={form[key]}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              {enrichNote && (
                <p className="text-xs text-[var(--muted)] bg-[var(--chip)] rounded-md px-3 py-2">
                  {enrichNote}
                </p>
              )}
              {manualError && (
                <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] rounded-md px-3 py-2">
                  {manualError}
                </p>
              )}
              {manualMsg && <p className="text-xs text-[var(--teal)]">{manualMsg}</p>}
            </div>
            <button type="submit" className="btn-primary mt-2 w-full shrink-0" disabled={manualBusy}>
              {manualBusy ? "处理中…" : "保存到词表"}
            </button>
          </form>
        </section>

        {/* 文件导入 */}
        <section className="no-scrollbar flex min-h-0 flex-col gap-2 overflow-y-auto">
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

          <div className="panel mt-auto space-y-2 p-3 text-xs text-[var(--muted)]">
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
            <button
              type="button"
              className="btn-secondary"
              disabled={fileBusy}
              onClick={async () => {
                setFileBusy(true);
                setFileError(null);
                try {
                  const res = await fetch("/api/import/preset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ preset: "shanghai-2026" }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setFileError(data.error || "预设导入失败");
                    return;
                  }
                  setFileResult(data);
                } catch {
                  setFileError("预设导入失败");
                } finally {
                  setFileBusy(false);
                }
              }}
            >
              一键导入「上海初中考纲 2026」到我的词表
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
