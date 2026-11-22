"use client";

import { withBase } from "@/lib/base-path";
import { useCallback, useEffect, useRef, useState } from "react";
import { NoteArt } from "@/components/Illustrations";
import { sanitizeHtml } from "@/lib/notes/sanitize";

type Note = {
  id: string;
  title: string;
  content: string;
  contentHtml: string | null;
  createdAt: string;
  updatedAt: string;
};

type NotesResponse = {
  notes?: Note[];
  note?: Note;
  error?: string;
};

type View = "list" | "edit" | "review";

/** 富文本详情/复习视图的排版：段落、列表间距 + 内联字号/颜色由 HTML 自带的 style 生效。 */
const RICH_CONTENT_CLASS =
  "break-words text-sm leading-relaxed [&_div]:my-1 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5";

const TEXT_COLORS = [
  { value: "#0f2f3d", label: "黑色" },
  { value: "#1d4ed8", label: "深蓝" },
  { value: "#7c3aed", label: "紫色" },
  { value: "#0ea5a0", label: "青色" },
  { value: "#f2743a", label: "橙色" },
  { value: "#e11d48", label: "红色" },
  { value: "#16a34a", label: "绿色" },
  { value: "#5d7385", label: "灰色" },
];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** 旧笔记只有纯文本时，按行转成 <p> 注入编辑器；空行用 <p><br></p> 占位。 */
function plainTextToHtml(text: string): string {
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
    .join("");
}

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
  const [saving, setSaving] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  /** 卡片点击后弹出的详情窗口 */
  const [modalNote, setModalNote] = useState<Note | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  /** 进入编辑视图时写入编辑器的初始 HTML；只在挂载时应用一次，之后 DOM 完全由浏览器管理 */
  const initialHtmlRef = useRef<string>("");
  /** 工具栏（下拉框/取色器）会抢焦点，记住最近一次编辑器内的选区以便恢复。 */
  const savedRangeRef = useRef<Range | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(withBase("/api/notes"));
      const data = (await res.json().catch(() => ({}))) as NotesResponse;
      if (!res.ok) throw new Error(data.error || "加载知识点失败");
      const list = Array.isArray(data.notes) ? data.notes : [];
      // 渲染前统一做一次白名单过滤，详情/复习/编辑都只接触 sanitize 后的 HTML。
      setNotes(
        list.map((note) => ({
          ...note,
          contentHtml: note.contentHtml ? sanitizeHtml(note.contentHtml) : null,
        })),
      );
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

  // 进入编辑视图时清空上次记住的选区（旧编辑器的 DOM 节点已失效）。
  useEffect(() => {
    if (view !== "edit") return;
    savedRangeRef.current = null;
  }, [view, editingId]);

  // 只在进入编辑（或切换笔记）时把初始 HTML 写入编辑器；
  // 之后不再由 React 控制内容，避免改标题等重渲染把正文重置掉。
  useEffect(() => {
    if (view !== "edit") return;
    const editor = editorRef.current;
    if (!editor) return;
    const html = initialHtmlRef.current;
    if (editor.innerHTML !== html) editor.innerHTML = html;
  }, [view, editingId]);

  function nodeInsideEditor(node: Node | null): boolean {
    const editor = editorRef.current;
    return Boolean(editor && node && editor.contains(node));
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    if (!nodeInsideEditor(selection.anchorNode) || !nodeInsideEditor(selection.focusNode)) return;
    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
  }

  /** 恢复编辑器内的选区（工具栏 select / color input 会抢走焦点）。 */
  function restoreEditorSelection(): boolean {
    const editor = editorRef.current;
    if (!editor) return false;
    if (document.activeElement !== editor) editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;

    const saved = savedRangeRef.current;
    if (saved && nodeInsideEditor(saved.commonAncestorContainer)) {
      try {
        selection.removeAllRanges();
        selection.addRange(saved);
        return true;
      } catch {
        // 选区节点被 execCommand 拆分后可能失效，退回当前光标位置。
      }
    }
    return selection.rangeCount > 0 && nodeInsideEditor(selection.anchorNode);
  }

  function applyCommand(command: "bold" | "italic" | "underline" | "removeFormat") {
    if (!restoreEditorSelection()) return;
    document.execCommand(command, false);
    rememberSelection();
  }

  function applyColor(color: string) {
    if (!restoreEditorSelection()) return;
    // 临时开启 styleWithCSS，让 foreColor 产出 <span style="color: …"> 而非 <font>。
    let previous = false;
    try {
      previous = document.queryCommandState("styleWithCSS");
    } catch {
      previous = false;
    }
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, color);
    document.execCommand("styleWithCSS", false, String(previous));
    rememberSelection();
  }

  /** 字号：把选中文字替换成带内联 font-size 的 span（简单可靠，不依赖 fontSize 1..7）。 */
  function applyFontSize(size: number) {
    if (!restoreEditorSelection()) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;
    const text = range.toString();
    if (!text) return;
    const html = `<span style="font-size:${size}px">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</span>`;
    document.execCommand("insertHTML", false, html);
    rememberSelection();
  }

  /** 粘贴只取纯文本，杜绝外部样式/脚本/图片进入编辑器。 */
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;

    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    rememberSelection();
  }

  /** 每级缩进像素；Tab 加一级，Shift/Ctrl+Tab 减一级 */
  const INDENT_STEP = 24;

  /**
   * 调整选区覆盖的块级段落的左缩进（用 margin-left，可被 sanitize 保留）。
   * 纯文本（没有块级元素）时，Tab 退化为插入空格。
   */
  function changeIndent(delta: number) {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    const candidates = Array.from(editor.querySelectorAll<HTMLElement>("p, div, li")).filter(
      (el) => range.intersectsNode(el),
    );
    // 只保留最外层块，避免嵌套 div 被重复缩进
    const blocks = candidates.filter(
      (el) => !candidates.some((other) => other !== el && other.contains(el)),
    );

    if (blocks.length === 0) {
      if (delta > 0) document.execCommand("insertText", false, "    ");
      return;
    }

    for (const el of blocks) {
      const current = Number.parseFloat(el.style.marginLeft) || 0;
      const next = Math.max(0, Math.min(240, current + delta));
      if (next === 0) el.style.removeProperty("margin-left");
      else el.style.marginLeft = `${next}px`;
    }
    rememberSelection();
  }

  const message = error ? (
    <p className="shrink-0 text-xs text-[var(--danger)]">{error}</p>
  ) : notice ? (
    <p className="shrink-0 text-xs text-[var(--teal)]">{notice}</p>
  ) : null;

  function startCreate() {
    setEditingId(null);
    setDraftTitle("");
    initialHtmlRef.current = "";
    setError(null);
    setNotice(null);
    setView("edit");
  }

  function startEdit(note: Note) {
    setEditingId(note.id);
    setDraftTitle(note.title);
    const html = note.contentHtml ? sanitizeHtml(note.contentHtml) : plainTextToHtml(note.content);
    initialHtmlRef.current = html;
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
    const editor = editorRef.current;
    const contentHtml = sanitizeHtml(editor?.innerHTML ?? "");
    const content = editor?.innerText ?? "";
    if (!content.trim()) {
      setError("内容不能为空");
      return;
    }
    if (contentHtml.length > 20000) {
      setError("富文本内容过长（最多 20000 字符）");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(withBase(editingId ? `/api/notes/${editingId}` : "/api/notes"), {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim() || "未命名",
          content,
          contentHtml: contentHtml || null,
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
      const res = await fetch(withBase(`/api/notes/${note.id}`), { method: "DELETE" });
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
                      <NoteArt className="h-24 w-auto opacity-80" />
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
                支持加粗、字号与颜色，适合词语辨析、语法笔记、易混点对比。
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
            <div
              className="flex shrink-0 flex-wrap items-center gap-1 text-xs"
              role="toolbar"
              aria-label="文字格式工具栏"
            >
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs font-bold"
                title="加粗（Ctrl/⌘ + B）"
                aria-label="加粗"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyCommand("bold")}
              >
                B
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs italic"
                title="斜体（Ctrl/⌘ + I）"
                aria-label="斜体"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyCommand("italic")}
              >
                I
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs underline"
                title="下划线（Ctrl/⌘ + U）"
                aria-label="下划线"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyCommand("underline")}
              >
                U
              </button>
              <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
              <select
                className="field w-20 shrink-0 py-1 text-xs"
                aria-label="字号"
                title="字号（作用于选中文字）"
                defaultValue=""
                onChange={(e) => {
                  const size = Number(e.target.value);
                  if (size > 0) applyFontSize(size);
                  e.currentTarget.value = "";
                }}
              >
                <option value="">字号</option>
                <option value="14">14px</option>
                <option value="16">16px</option>
                <option value="18">18px</option>
                <option value="20">20px</option>
                <option value="24">24px</option>
              </select>
              <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className="h-5 w-5 shrink-0 rounded border border-[var(--line)] transition hover:scale-110"
                  style={{ backgroundColor: color.value }}
                  title={`颜色：${color.label}`}
                  aria-label={`颜色：${color.label}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyColor(color.value)}
                />
              ))}
              <input
                type="color"
                className="h-6 w-8 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0"
                defaultValue="#0f2f3d"
                title="自定义颜色"
                aria-label="自定义颜色"
                onChange={(e) => applyColor(e.target.value)}
              />
              <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                title="清除选中文字的格式"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyCommand("removeFormat")}
              >
                清除格式
              </button>
            </div>
            {/* 初始 HTML 已先经 sanitize，进入编辑时写入一次；之后内容由浏览器管理，重渲染不会重置。 */}
            <div
              ref={editorRef}
              role="textbox"
              aria-multiline="true"
              aria-label="知识点内容"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              className="field no-scrollbar min-h-[12rem] flex-1 overflow-y-auto break-words text-sm leading-relaxed"
              onInput={rememberSelection}
              onMouseUp={rememberSelection}
              onKeyUp={rememberSelection}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  // Tab 缩进；Shift+Tab / Ctrl+Tab 反向缩进
                  e.preventDefault();
                  changeIndent(e.shiftKey || e.ctrlKey || e.metaKey ? -INDENT_STEP : INDENT_STEP);
                  return;
                }
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs text-[var(--muted)]">
              选中文字后可加粗 / 设字号 / 改颜色 · Ctrl / ⌘ + Enter 保存
            </p>
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
                  className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3"
                >
                  {reviewNote.contentHtml ? (
                    <div
                      className={RICH_CONTENT_CLASS}
                      dangerouslySetInnerHTML={{ __html: reviewNote.contentHtml }}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {reviewNote.content || "（无内容）"}
                    </p>
                  )}
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
              {modalNote.contentHtml ? (
                <div
                  className={RICH_CONTENT_CLASS}
                  dangerouslySetInnerHTML={{ __html: modalNote.contentHtml }}
                />
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {modalNote.content || "（无内容）"}
                </p>
              )}
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
