"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookArt } from "@/components/Illustrations";

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

type ListSummary = {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  total: number;
  studied: number;
};

type ImportResult = {
  listId: string;
  listName: string;
  created: number;
  updated: number;
  total: number;
  errors: string[];
};

type Notice = { text: string; tone: "ok" | "danger" };

const PAGE_SIZE = 15;
const MAX_PERCENT = 100;

function percentOf(list: ListSummary): number {
  if (list.total <= 0) return 0;
  return (list.studied / list.total) * 100;
}

export default function WordsPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [msg, setMsg] = useState<Notice | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  /* ---------------- 词库列表 ---------------- */
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  /* ---------------- 导入 ---------------- */
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = entries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const activeList = listId ? (lists.find((l) => l.id === listId) ?? null) : null;

  /* ---------------- 悬浮朗读 ---------------- */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverWordRef = useRef<string | null>(null);
  const speakSeqRef = useRef(0);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  /** 立刻停掉播放中的音频 / 合成音，并让在途请求作废（seq 自增） */
  const stopPlayback = useCallback(() => {
    speakSeqRef.current += 1;
    clearHoverTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [clearHoverTimer]);

  /** 降级路径：浏览器内置语音合成 */
  const speakWithSynthesis = useCallback((word: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  }, []);

  const speakWord = useCallback(
    async (word: string) => {
      const seq = ++speakSeqRef.current;
      const stale = () => speakSeqRef.current !== seq;
      try {
        const res = await fetch("/api/speech/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: word, language: "en-US" }),
        });
        if (stale()) return;
        const data = res.ok
          ? ((await res.json()) as { audioBase64?: string; mimeType?: string })
          : null;
        if (stale()) return;
        if (data?.audioBase64) {
          const audio = new Audio(
            `data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`,
          );
          audioRef.current = audio;
          audio.onended = () => {
            if (audioRef.current === audio) audioRef.current = null;
          };
          audio.onerror = () => {
            if (audioRef.current === audio) audioRef.current = null;
            if (!stale()) speakWithSynthesis(word);
          };
          try {
            await audio.play();
          } catch {
            if (audioRef.current === audio) audioRef.current = null;
            if (!stale()) speakWithSynthesis(word);
          }
          return;
        }
        speakWithSynthesis(word);
      } catch {
        if (!stale()) speakWithSynthesis(word);
      }
    },
    [speakWithSynthesis],
  );

  /** 进入一行 / 单词单元格：同词去重；换词则重排 250ms 防抖 */
  const handleRowEnter = useCallback(
    (word: string) => {
      if (!word || hoverWordRef.current === word) return;
      hoverWordRef.current = word;
      clearHoverTimer();
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        void speakWord(word);
      }, 250);
    },
    [clearHoverTimer, speakWord],
  );

  const handleRowLeave = useCallback(() => {
    hoverWordRef.current = null;
    stopPlayback();
  }, [stopPlayback]);

  // 卸载清理：定时器 + 音频 + 合成音，避免幽灵播放
  useEffect(() => stopPlayback, [stopPlayback]);
  // 翻页时同样复位，防止上一页的音频继续播
  useEffect(() => {
    hoverWordRef.current = null;
    stopPlayback();
  }, [safePage, stopPlayback]);

  /* ---------------- 数据加载 ---------------- */

  async function loadEntries(nextListId: string | null, query: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const keyword = query.trim();
      if (keyword) params.set("q", keyword);
      if (nextListId) params.set("listId", nextListId);
      const qs = params.toString();
      const res = await fetch(`/api/entries${qs ? `?${qs}` : ""}`);
      const data = (await res.json().catch(() => ({}))) as {
        entries?: Entry[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "加载词条失败");
      setEntries(data.entries || []);
      setPage(0);
      // 成功加载后清掉上一次的错误提示，避免旧错误一直挂着
      setMsg((prev) => (prev && prev.tone === "danger" ? null : prev));
    } catch (e) {
      setEntries([]);
      setMsg({ text: e instanceof Error ? e.message : "加载词条失败", tone: "danger" });
    } finally {
      setLoading(false);
    }
  }

  async function loadLists() {
    setListsLoading(true);
    setListsError(null);
    try {
      const res = await fetch("/api/lists");
      const data = (await res.json().catch(() => ({}))) as {
        lists?: ListSummary[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "加载词库失败");
      setLists(data.lists || []);
    } catch (e) {
      setListsError(e instanceof Error ? e.message : "加载词库失败");
    } finally {
      setListsLoading(false);
    }
  }

  /** 切换词库筛选：同步 ?listId= 到地址栏，刷新后保持 */
  function selectList(next: string | null) {
    setListId(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("listId", next);
      else url.searchParams.delete("listId");
      window.history.replaceState(null, "", url.toString());
    }
    void loadEntries(next, q);
  }

  useEffect(() => {
    const initialListId = new URLSearchParams(window.location.search).get("listId");
    if (initialListId) setListId(initialListId);
    void loadEntries(initialListId, "");
    void loadLists();
  }, []);

  /* ---------------- 词库操作 ---------------- */

  function startRename(list: ListSummary) {
    setRenamingId(list.id);
    setRenameValue(list.name);
  }

  async function submitRename(list: ListSummary) {
    const name = renameValue.trim();
    if (!name) {
      setMsg({ text: "词库名不能为空", tone: "danger" });
      return;
    }
    setRenameBusy(true);
    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "重命名失败");
      setLists((prev) => prev.map((item) => (item.id === list.id ? { ...item, name } : item)));
      setRenamingId(null);
      setMsg({ text: "词库已重命名", tone: "ok" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "重命名失败", tone: "danger" });
    } finally {
      setRenameBusy(false);
    }
  }

  async function removeList(list: ListSummary) {
    if (
      !window.confirm(
        `确认删除词库《${list.name}》？其中 ${list.total} 个词条会一并删除，且不可恢复。`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/lists/${list.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "删除词库失败");
      if (renamingId === list.id) setRenamingId(null);
      if (listId === list.id) {
        selectList(null);
      } else {
        void loadEntries(listId, q);
      }
      void loadLists();
      setMsg({ text: `已删除词库《${list.name}》`, tone: "ok" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "删除词库失败", tone: "danger" });
    }
  }

  /* ---------------- 导入操作 ---------------- */

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setImportError("请选择 CSV 或 Excel（.xlsx / .xls）文件");
      return;
    }
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // 不传 listName：服务端默认用文件名（去扩展名）作为词库名
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as ImportResult & { error?: string };
      if (!res.ok) {
        setImportError(data.error || "导入失败");
        return;
      }
      setImportResult(data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void loadLists();
      if (data.listId) selectList(data.listId);
      setMsg({ text: `已导入到词库《${data.listName}》`, tone: "ok" });
    } catch {
      setImportError("网络错误，导入失败，请重试");
    } finally {
      setImportBusy(false);
    }
  }

  /* ---------------- 词条编辑 / 删除 ---------------- */

  async function save() {
    if (!editing) return;
    try {
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
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "保存失败");
      }
      setEditing(null);
      setMsg({ text: "已保存", tone: "ok" });
      void loadEntries(listId, q);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "保存失败", tone: "danger" });
    }
  }

  async function remove(id: string) {
    if (!window.confirm("确认删除该词条？")) return;
    try {
      const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "删除失败");
      }
      setMsg({ text: "已删除词条", tone: "ok" });
      void loadEntries(listId, q);
      void loadLists();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "删除失败", tone: "danger" });
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 标题 + 搜索 + 导入入口 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl">词库维护</h1>
          <p className="text-xs text-[var(--muted)]">
            {listId ? `已筛选：${activeList?.name ?? "该词库"}` : `全部词库 ${lists.length} 个`}
            {" · "}当前 {loading ? "加载中…" : `${entries.length} 条`} · 第 {safePage + 1}/{pageCount} 页
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="field w-52"
            placeholder="搜索单词 / 释义"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void loadEntries(listId, q)}
          />
          <button type="button" className="btn-secondary" onClick={() => void loadEntries(listId, q)}>
            搜索
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setImportOpen((open) => !open)}
          >
            {importOpen ? "收起导入" : "导入词表"}
          </button>
        </div>
      </div>

      {/* 词库卡片区 */}
      <section className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            我的词库
            <span className="ml-1 text-xs font-normal text-[var(--muted)]">
              {listsLoading ? "刷新中…" : `${lists.length} 个`}
            </span>
          </h2>
          <div className="flex items-center gap-3 text-xs">
            {listId && (
              <button
                type="button"
                className="text-[var(--teal)] hover:underline"
                onClick={() => selectList(null)}
              >
                查看全部
              </button>
            )}
            <button
              type="button"
              className="text-[var(--teal)] hover:underline disabled:opacity-50"
              disabled={listsLoading}
              onClick={() => void loadLists()}
            >
              刷新
            </button>
          </div>
        </div>

        {listsError && (
          <p className="mb-1 rounded-md bg-[var(--danger-soft)] px-3 py-1 text-xs text-[var(--danger)]">
            {listsError}
          </p>
        )}

        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {lists.map((list) => {
            const active = listId === list.id;
            const percent = percentOf(list);
            return (
              <div
                key={list.id}
                className={`panel w-56 shrink-0 p-2.5 transition ${
                  active ? "ring-2 ring-[var(--teal)]" : "hover:border-[var(--teal)]"
                }`}
              >
                {renamingId === list.id ? (
                  <div className="space-y-1">
                    <input
                      className="field !py-1 !text-sm"
                      value={renameValue}
                      autoFocus
                      maxLength={80}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitRename(list);
                        } else if (e.key === "Escape") {
                          setRenamingId(null);
                        }
                      }}
                    />
                    <div className="flex justify-end gap-2 text-xs">
                      <button type="button" onClick={() => setRenamingId(null)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="text-[var(--teal)] disabled:opacity-50"
                        disabled={renameBusy}
                        onClick={() => void submitRename(list)}
                      >
                        {renameBusy ? "保存中…" : "保存"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        title={`筛选《${list.name}》`}
                        className={`min-w-0 truncate text-left text-sm font-medium ${
                          active ? "text-[var(--teal)]" : ""
                        }`}
                        onClick={() => selectList(list.id)}
                      >
                        {list.name}
                      </button>
                      <span className="badge shrink-0">
                        {list.source === "manual" ? "手动" : "导入"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      共 {list.total} 词 · 已背 {list.studied} 词
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--chip)]">
                        <div
                          className="h-full rounded-full bg-[var(--teal)]"
                          style={{ width: `${Math.min(percent, MAX_PERCENT)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-[var(--muted)]">
                        {percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 flex justify-end gap-3 text-xs">
                      <button
                        type="button"
                        className="text-[var(--teal)] hover:underline"
                        onClick={() => startRename(list)}
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        className="text-[var(--muted)] hover:text-[var(--danger)]"
                        onClick={() => void removeList(list)}
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {lists.length === 0 && !listsLoading && (
            <p className="px-1 py-3 text-xs text-[var(--muted)]">
              还没有词库，点右上「导入词表」上传 CSV / Excel，词库名默认取文件名。
            </p>
          )}
        </div>
      </section>

      {/* 导入面板（原 /import 页布局） */}
      {importOpen && (
        <form onSubmit={submitImport} className="panel shrink-0 space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h2 className="font-display text-sm">CSV / Excel 批量导入</h2>
            <p className="text-[11px] text-[var(--muted)]">
              词库名默认取文件名（去扩展名）；同名文件再次导入会复用该词库并覆盖同名词条。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="block min-w-0 flex-1 text-xs"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setImportError(null);
              }}
            />
            <button type="submit" className="btn-primary !px-3 !py-1.5 !text-xs" disabled={importBusy}>
              {importBusy ? "导入中…" : "开始导入"}
            </button>
            <a className="btn-secondary !px-3 !py-1.5 !text-xs" href="/api/import/template">
              下载 Excel 模板
            </a>
            <a className="text-xs text-[var(--teal)] hover:underline" href="/templates/words-import.xlsx">
              静态模板
            </a>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--muted)]">
            固定列序：
            <code className="ml-1 rounded bg-[var(--chip)] px-1 text-[11px]">
              序号,单词,音标,词性,中文释义,例句,相关词组,近义词,反义词
            </code>
            （首行表头与首列序号不导入；近/反义词写入 related；同词覆盖）。单文件 ≤ 1MB。
          </p>
          {importError && (
            <p className="rounded-md bg-[var(--danger-soft)] px-3 py-1.5 text-xs text-[var(--danger)]">
              {importError}
            </p>
          )}
          {importResult && (
            <div className="rounded-md bg-[var(--chip)] px-3 py-2 text-xs">
              <p className="font-medium">导入完成 · {importResult.listName}</p>
              <p className="text-[var(--muted)]">
                共 {importResult.total} 条：新建 {importResult.created}，覆盖更新 {importResult.updated}
              </p>
              {(importResult.errors?.length ?? 0) > 0 && (
                <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5 text-[var(--accent)]">
                  {importResult.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}

      {msg && (
        <p
          className={`shrink-0 text-xs ${
            msg.tone === "danger" ? "text-[var(--danger)]" : "text-[var(--teal)]"
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* 单词表 */}
      <div className="panel no-scrollbar min-h-0 flex-1 overflow-auto">
        <table className="w-full text-base">
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
              <tr
                key={e.id}
                className="hover:bg-[var(--chip)]/50"
                onMouseEnter={() => handleRowEnter(e.word)}
                onMouseLeave={handleRowLeave}
              >
                <td
                  className="px-3 py-1.5 font-medium"
                  onMouseEnter={() => handleRowEnter(e.word)}
                >
                  {e.word}
                  {e.pos && <span className="badge ml-2">{e.pos}</span>}
                </td>
                <td className="max-w-[16rem] truncate px-3 py-1.5 text-[var(--muted)]">
                  {e.glossZh || "—"}
                </td>
                <td className="group hidden px-3 py-1.5 text-[var(--muted)] md:table-cell">
                  <span
                    className={
                      e.ipa
                        ? "inline-block origin-left transition duration-150 group-hover:scale-125 group-hover:text-[var(--accent)]"
                        : "inline-block"
                    }
                  >
                    {e.ipa || "—"}
                  </span>
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
                  <button type="button" className="text-[var(--danger)]" onClick={() => void remove(e.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8">
                  <div className="anim-fade-up flex flex-col items-center gap-2 text-center text-[var(--muted)]">
                    <BookArt className="h-20 w-auto opacity-80" />
                    <p className="text-sm">
                      {listId ? "该词库暂无词条。" : "暂无词条，请先导入 CSV。"}
                    </p>
                  </div>
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
          <div className="panel w-full max-w-lg space-y-3 p-6">
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
              <button type="button" className="btn-primary" onClick={() => void save()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
