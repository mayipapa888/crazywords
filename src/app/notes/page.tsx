"use client";

import { useCallback, useEffect, useState } from "react";

type Note = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type NotesResponse = {
  notes?: Note[];
  note?: Note;
  error?: string;
};

type View = "list" | "edit" | "review";

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notes");
      const data = (await res.json().catch(() => ({}))) as NotesResponse;
      if (!res.ok) throw new Error(data.error || "加载知识点失败");
      setNotes(Array.isArray(data.notes) ? data.notes : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载知识点失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const keyword = query.trim().toLowerCase();
  const visibleNotes = keyword
    ? notes.filter(
        (note) =>
          note.title.toLowerCase().includes(keyword) ||
          note.content.toLowerCase().includes(keyword),
      )
    : notes;
  const reviewIndexSafe = Math.min(reviewIndex, Math.max(0, visibleNotes.length - 1));
  const reviewNote = visibleNotes[reviewIndexSafe] ?? null;

  useEffect(() => {
    if (view !== "review") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setReviewIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setReviewIndex((current) =>
          Math.min(Math.max(0, visibleNotes.length - 1), current + 1),
        );
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, visibleNotes.length]);

  const message = error ? (
    <p className="shrink-0 text-xs text-[var(--danger)]">{error}</p>
  ) : notice ? (
    <p className="shrink-0 text-xs text-[var(--teal)]">{notice}</p>
  ) : null;

  function startCreate() {
    setEditingId(null);
    setDraftTitle("");
    setDraftContent("");
    setError(null);
    setNotice(null);
    setView("edit");
  }

  function startEdit(note: Note) {
    setEditingId(note.id);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setError(null);
    setNotice(null);
    setView("edit");
  }

  function startReview() {
    setReviewIndex(0);
    setError(null);
    setNotice(null);
    setView("review");
  }

  function backToList() {
    setView("list");
    setError(null);
  }

  async function save() {
    if (saving) return;
    if (!draftContent.trim()) {
      setError("内容不能为空");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(editingId ? `/api/notes/${editingId}` : "/api/notes", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim() || "未命名",
          content: draftContent,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as NotesResponse;
      if (!res.ok) throw new Error(data.error || "保存失败");

      setView("list");
      setEditingId(null);
      setNotice(editingId ? "已保存修改" : "已新建知识点");
      if (!editingId) setQuery("");
      await loadNotes();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(note: Note) {
    if (!window.confirm(`确认删除「${note.title}」？删除后不可恢复。`)) return;

    setError(null);
    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as NotesResponse;
      if (!res.ok) throw new Error(data.error || "删除失败");

      setNotes((current) => current.filter((item) => item.id !== note.id));
      setNotice("已删除");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {view === "list" && (
        <>
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="font-display text-xl">知识点</h1>
              <p className="text-xs text-[var(--muted)]">
                词语辨析 / 语法笔记 · 共 {notes.length} 条
                {keyword ? ` · 匹配 ${visibleNotes.length} 条` : ""}
                {loading ? " · 加载中…" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="field w-44 py-1.5 text-xs"
                placeholder="搜索标题 / 内容"
                aria-label="搜索知识点"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary py-1.5 text-xs"
                disabled={loading || (Boolean(error) && notes.length === 0)}
                onClick={startReview}
              >
                开始复习
              </button>
              <button type="button" className="btn-primary py-1.5 text-xs" onClick={startCreate}>
                + 新建
              </button>
            </div>
          </header>

          {message}

          <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
            <ul className="no-scrollbar min-h-0 flex-1 divide-y divide-[var(--line)] overflow-y-auto">
              {visibleNotes.map((note) => (
                <li key={note.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{note.title}</p>
                    <p className="line-clamp-2 whitespace-pre-line break-words text-xs leading-snug text-[var(--muted)]">
                      {note.content || "（无内容）"}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      更新于 {formatUpdatedAt(note.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="text-[var(--teal)] hover:underline"
                      onClick={() => startEdit(note)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="text-[var(--danger)] hover:underline"
                      onClick={() => void remove(note)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}

              {loading && notes.length === 0 && (
                <li className="px-3 py-10 text-center text-xs text-[var(--muted)]">加载中…</li>
              )}
              {!loading && visibleNotes.length === 0 && (
                <li className="px-3 py-10 text-center text-xs text-[var(--muted)]">
                  {error ? (
                    <>
                      加载失败，
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void loadNotes()}
                      >
                        重试
                      </button>
                    </>
                  ) : notes.length === 0 ? (
                    "还没有知识点，点「+ 新建」记录词语辨析或语法笔记"
                  ) : (
                    "没有匹配的笔记"
                  )}
                </li>
              )}
            </ul>
          </div>
        </>
      )}

      {view === "edit" && (
        <>
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="font-display text-xl">{editingId ? "编辑知识点" : "新建知识点"}</h1>
              <p className="text-xs text-[var(--muted)]">
                支持多行，适合词语辨析、语法笔记、易混点对比。
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary py-1.5 text-xs"
              onClick={backToList}
              disabled={saving}
            >
              返回列表
            </button>
          </header>

          {message}

          <div className="panel flex min-h-0 flex-1 flex-col gap-2 p-3">
            <input
              className="field shrink-0"
              placeholder="标题（留空则为「未命名」）"
              aria-label="知识点标题"
              maxLength={120}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
            <textarea
              className="field no-scrollbar min-h-0 flex-1 resize-none leading-relaxed"
              placeholder="内容，可多行…"
              aria-label="知识点内容"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs text-[var(--muted)]">Ctrl / ⌘ + Enter 保存</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary py-1.5 text-xs"
                onClick={backToList}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary py-1.5 text-xs"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </footer>
        </>
      )}

      {view === "review" && (
        <>
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="font-display text-xl">复习知识点</h1>
              <p className="text-xs text-[var(--muted)]">
                一次一条 · 键盘 ← → 翻页 · 共 {visibleNotes.length} 条
              </p>
            </div>
            <button type="button" className="btn-secondary py-1.5 text-xs" onClick={backToList}>
              返回列表
            </button>
          </header>

          {message}

          <div className="panel mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden">
            {reviewNote ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
                <h2 className="shrink-0 text-base font-medium">{reviewNote.title}</h2>
                <div
                  key={reviewNote.id}
                  className="no-scrollbar min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed"
                >
                  {reviewNote.content}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm text-[var(--muted)]">
                  {notes.length === 0
                    ? "还没有可复习的笔记，先去新建一条吧"
                    : "当前搜索没有匹配的笔记"}
                </p>
                <button
                  type="button"
                  className="btn-primary py-1.5 text-xs"
                  onClick={notes.length === 0 ? startCreate : backToList}
                >
                  {notes.length === 0 ? "去新建" : "返回列表"}
                </button>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-2">
            <button
              type="button"
              className="btn-secondary py-1.5 text-xs"
              disabled={!reviewNote || reviewIndexSafe <= 0}
              onClick={() => setReviewIndex(Math.max(0, reviewIndexSafe - 1))}
            >
              上一页
            </button>
            <p className="text-xs text-[var(--muted)]">
              第 {reviewNote ? reviewIndexSafe + 1 : 0} / {visibleNotes.length} 页
            </p>
            <button
              type="button"
              className="btn-secondary py-1.5 text-xs"
              disabled={!reviewNote || reviewIndexSafe >= visibleNotes.length - 1}
              onClick={() => setReviewIndex(Math.min(visibleNotes.length - 1, reviewIndexSafe + 1))}
            >
              下一页
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
