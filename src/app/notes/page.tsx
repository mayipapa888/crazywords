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
  /** 卡片点击后弹出的详情窗口 */
  const [modalNote, setModalNote] = useState<Note | null>(null);

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

  const backToList = useCallback(() => {
    setView("list");
    setError(null);
  }, []);

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
      } else if (event.key === "Escape") {
        event.preventDefault();
        backToList();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, visibleNotes.length, backToList]);

  // 弹窗：Esc 关闭
  useEffect(() => {
    if (!modalNote) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setModalNote(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalNote]);

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

  function openCard(note: Note) {
    setError(null);
    setNotice(null);
    setModalNote(note);
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
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
              {visibleNotes.length > 0 ? (
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {visibleNotes.map((note) => (
                    <li key={note.id} className="relative h-60">
                      <article className="panel flex h-full flex-col p-3 transition-shadow hover:shadow-md">
                        <button
                          type="button"
                          className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)]"
                          aria-label={`查看知识点「${note.title}」`}
                          onClick={() => openCard(note)}
                        />
                        <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col">
                          <h2 className="truncate text-sm font-bold">{note.title}</h2>
                          <p className="mt-1 line-clamp-6 flex-1 overflow-hidden whitespace-pre-line break-words text-xs leading-snug text-[var(--muted)]">
                            {note.content || "（无内容）"}
                          </p>
                          <div className="pointer-events-auto mt-auto flex shrink-0 items-center justify-between gap-2 pt-2 text-xs">
                            <span className="truncate text-[var(--muted)]">
                              更新于 {formatUpdatedAt(note.updatedAt)}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                className="text-[var(--teal)] hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(note);
                                }}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className="text-[var(--danger)] hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void remove(note);
                                }}
                              >
                                删除
                              </button>
                            </span>
                          </div>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              ) : loading && notes.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-xs text-[var(--muted)]">
                  加载中…
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  {error ? (
                    <>
                      <p className="text-sm text-[var(--danger)]">加载失败</p>
                      <p className="text-xs text-[var(--muted)]">
                        请检查网络后重试，或稍后再试。
                      </p>
                      <button
                        type="button"
                        className="btn-primary py-1.5 text-xs"
                        onClick={() => void loadNotes()}
                      >
                        重试
                      </button>
                    </>
                  ) : notes.length === 0 ? (
                    <>
                      <p className="text-sm">还没有知识点</p>
                      <p className="text-xs text-[var(--muted)]">
                        记录词语辨析、语法笔记或易混点对比，点击卡片可查看完整内容。
                      </p>
                      <button
                        type="button"
                        className="btn-primary py-1.5 text-xs"
                        onClick={startCreate}
                      >
                        + 新建
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">没有匹配的笔记</p>
                      <p className="text-xs text-[var(--muted)]">
                        换个关键词试试，或清空搜索查看全部卡片。
                      </p>
                      <button
                        type="button"
                        className="btn-secondary py-1.5 text-xs"
                        onClick={() => setQuery("")}
                      >
                        清空搜索
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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
              <h1 className="font-display text-xl">知识点卡片</h1>
              <p className="text-xs text-[var(--muted)]">
                一次一条 · 键盘 ← → 翻页 · Esc 返回卡片网格 · 共 {visibleNotes.length} 条
              </p>
            </div>
            <button type="button" className="btn-secondary py-1.5 text-xs" onClick={backToList}>
              返回卡片
            </button>
          </header>

          {message}

          <div className="panel mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden">
            {reviewNote ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                  <h2 className="min-w-0 break-words text-base font-bold">{reviewNote.title}</h2>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-[var(--teal)] hover:underline"
                    onClick={() => startEdit(reviewNote)}
                  >
                    编辑
                  </button>
                </div>
                <div
                  key={reviewNote.id}
                  className="no-scrollbar min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed"
                >
                  {reviewNote.content || "（无内容）"}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm text-[var(--muted)]">
                  {notes.length === 0
                    ? "还没有可查看的知识点，先去新建一条吧"
                    : "当前搜索没有匹配的笔记"}
                </p>
                <div className="flex gap-2">
                  {notes.length === 0 && (
                    <button
                      type="button"
                      className="btn-primary py-1.5 text-xs"
                      onClick={startCreate}
                    >
                      去新建
                    </button>
                  )}
                  <button type="button" className="btn-secondary py-1.5 text-xs" onClick={backToList}>
                    返回卡片
                  </button>
                </div>
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
              ← 上一条
            </button>
            <p className="text-xs text-[var(--muted)]">
              第 {reviewNote ? reviewIndexSafe + 1 : 0} / {visibleNotes.length} 条
            </p>
            <button
              type="button"
              className="btn-secondary py-1.5 text-xs"
              disabled={!reviewNote || reviewIndexSafe >= visibleNotes.length - 1}
              onClick={() => setReviewIndex(Math.min(visibleNotes.length - 1, reviewIndexSafe + 1))}
            >
              下一条 →
            </button>
          </footer>
        </>
      )}

      {modalNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`知识点：${modalNote.title}`}
          onClick={() => setModalNote(null)}
        >
          <div
            className="panel flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
              <h2 className="min-w-0 flex-1 truncate text-base font-bold">{modalNote.title}</h2>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <button
                  type="button"
                  className="text-[var(--teal)] hover:underline"
                  onClick={() => {
                    const target = modalNote;
                    setModalNote(null);
                    startEdit(target);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="text-[var(--muted)] hover:underline"
                  onClick={() => setModalNote(null)}
                >
                  关闭
                </button>
              </div>
            </header>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {modalNote.content || "（无内容）"}
              </p>
            </div>
            <footer className="shrink-0 border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)]">
              更新于 {formatUpdatedAt(modalNote.updatedAt)} · 点击空白处或 Esc 关闭
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
