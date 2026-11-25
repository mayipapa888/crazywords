"use client";

import { withBase } from "@/lib/base-path";
import { useCallback, useEffect, useRef, useState } from "react";

type SenseView = {
  pos: string;
  defEn: string;
  defZh: string | null;
};

type EntryView = {
  id: string | null;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  examples?: string[];
  phrases: string[];
  synonyms?: string[];
  antonyms?: string[];
  related: string[];
  senses?: SenseView[];
};

type LookupResult = {
  query: string;
  found: boolean;
  source?: string;
  message?: string;
  warnings?: string[];
  inWordList?: boolean;
  localEntryId?: string | null;
  entry?: EntryView | null;
  fromAsr?: boolean;
};

/** 词性编辑：预置常用选项，输入框仍可直接键入自定义值（datalist 组合框） */
const POS_OPTIONS = [
  "noun.",
  "verb.",
  "adjective.",
  "adverb.",
  "prep.",
  "conj.",
  "pron.",
  "num.",
  "art.",
  "interj.",
] as const;

const POS_OPTIONS_ID = "lookup-pos-options";

/** 可选文本：空值 / 纯空白返回 undefined，避免把空串写进已有词条 */
function optionalText(value: string | null | undefined): string | undefined {
  const text = (value ?? "").trim();
  return text ? text : undefined;
}

/** 可选数组：空数组返回 undefined，不覆盖服务端已有内容 */
function optionalList(value: string[] | undefined): string[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

function playUtterance(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      // 浏览器语音也不可用：静默降级
      resolve();
    }
  });
}

/** 播放 TTS 返回的 base64 音频；holder 用于页面卸载 / 重播时打断当前音频 */
function playAudioBase64(
  audioBase64: string,
  mimeType?: string,
  holder?: { current: HTMLAudioElement | null },
): Promise<void> {
  return new Promise((resolve) => {
    const src = `data:${mimeType || "audio/mpeg"};base64,${audioBase64}`;
    const audio = new Audio(src);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (holder && holder.current === audio) holder.current = null;
      resolve();
    };
    if (holder) holder.current = audio;
    audio.onended = done;
    audio.onerror = done;
    // 主动 pause 时也应结束等待，避免 await 悬挂
    audio.onpause = done;
    void audio.play().then(undefined, done);
  });
}

export default function LookupPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [wrongAdded, setWrongAdded] = useState(false);
  const [wrongError, setWrongError] = useState<string | null>(null);
  // 就地编辑「基本意思」：草稿只在编辑态生效，保存成功后才写回 result.entry.glossZh
  const [editingGloss, setEditingGloss] = useState(false);
  const [glossDraft, setGlossDraft] = useState("");
  const [savingGloss, setSavingGloss] = useState(false);
  const [glossError, setGlossError] = useState<string | null>(null);
  const [glossMsg, setGlossMsg] = useState<string | null>(null);
  // 就地编辑「词性」：与释义编辑同构，草稿只在编辑态生效，保存成功后才写回
  const [editingPos, setEditingPos] = useState(false);
  const [posDraft, setPosDraft] = useState("");
  const [savingPos, setSavingPos] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [posMsg, setPosMsg] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  // 当前展示的单词：异步保存返回时用它判断用户是否已经查了别的词
  const currentWordRef = useRef<string | null>(null);
  currentWordRef.current = result?.entry?.word ?? null;
  // 自动朗读去重：记录最近一次朗读过的词（小写），只有词变化时才自动读
  const spokenWordRef = useRef<string | null>(null);
  /** 朗读代际：重播 / 卸载时自增，旧播报自行失效 */
  const speakGen = useRef(0);
  const wordAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopWordSpeech = useCallback(() => {
    speakGen.current += 1;
    const audio = wordAudioRef.current;
    wordAudioRef.current = null;
    if (audio) {
      try {
        audio.pause();
        audio.src = "";
      } catch {
        // 浏览器限制时忽略
      }
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  /** 英文朗读单词一遍：优先阿里云音频，失败退浏览器语音，再失败静默 */
  const speakWord = useCallback(
    async (rawWord: string) => {
      const word = rawWord.trim();
      if (!word) return;
      stopWordSpeech();
      // 手动重播也算「已朗读过这个词」，避免自动朗读的定时器随后再重复触发
      spokenWordRef.current = word.toLowerCase();
      const gen = speakGen.current;
      setSpeaking(true);
      try {
        const res = await fetch(withBase("/api/speech/tts"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: word, language: "en-US" }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          audioBase64?: string;
          mimeType?: string;
        };
        if (speakGen.current !== gen) return;
        if (res.ok && data.audioBase64) {
          await playAudioBase64(data.audioBase64, data.mimeType, wordAudioRef);
          return;
        }
        await playUtterance(word, "en-US");
      } catch {
        if (speakGen.current === gen) {
          await playUtterance(word, "en-US");
        }
      } finally {
        if (speakGen.current === gen) setSpeaking(false);
      }
    },
    [stopWordSpeech],
  );

  useEffect(() => {
    return () => {
      stopWordSpeech();
    };
  }, [stopWordSpeech]);

  // 「已保存」只短暂停留：2 秒后自动隐去，不占用行高
  useEffect(() => {
    if (!posMsg) return;
    const timer = setTimeout(() => setPosMsg(null), 2000);
    return () => clearTimeout(timer);
  }, [posMsg]);

  // 查询成功且拿到 entry.word 后自动朗读一次；同一词（改释义等状态更新）不会重复触发
  const speakableWord = result?.found ? (result.entry?.word ?? null) : null;
  useEffect(() => {
    const word = (speakableWord || "").trim();
    if (!word) return;
    const key = word.toLowerCase();
    if (spokenWordRef.current === key) return;
    // 延后一拍再标记 / 朗读：StrictMode 的「挂载→卸载→挂载」会清掉第一个定时器，
    // 最终只真正朗读一次，也不会被模拟卸载打断。
    const timer = setTimeout(() => {
      if (spokenWordRef.current === key) return;
      spokenWordRef.current = key;
      void speakWord(word);
    }, 0);
    return () => {
      clearTimeout(timer);
      // 换词 / 卸载：停掉本条词的播报
      stopWordSpeech();
    };
  }, [speakableWord, speakWord, stopWordSpeech]);

  const runLookup = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setError("请输入要查询的单词或中文释义");
      return;
    }
    setBusy(true);
    setError(null);
    setAddMsg(null);
    setWrongAdded(false);
    setWrongError(null);
    // 新查询会替换 result，编辑态与旧草稿一并丢弃，避免把释义写到别的词上
    setEditingGloss(false);
    setGlossDraft("");
    setGlossError(null);
    setGlossMsg(null);
    // 词性编辑态同理：换词后不允许把旧草稿落到新词上
    setEditingPos(false);
    setPosDraft("");
    setPosError(null);
    setPosMsg(null);
    try {
      const res = await fetch(withBase("/api/lookup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "查词失败");
        return;
      }
      setResult(data);
      if (data.query) {
        setText(data.query);
      }
    } catch {
      setError("查词失败");
    } finally {
      setBusy(false);
    }
  }, []);

  async function addToList() {
    if (!result?.entry?.word) return;
    setBusy(true);
    setAddMsg(null);
    setError(null);
    try {
      const e = result.entry;
      const res = await fetch(withBase("/api/entries/manual"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listName: "查词收藏",
          word: e.word,
          glossZh: e.glossZh,
          ipa: e.ipa,
          pos: e.pos,
          example: e.example,
          phrases: e.phrases,
          related: e.related,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "加入词表失败");
        return;
      }
      setAddMsg(data.overwritten ? "已覆盖写入词表「查词收藏」" : "已加入词表「查词收藏」");
      // 加入成功后该词已在词表中，隐藏「加入词表」按钮，避免重复加入；
      // 记下新建/命中的 entryId，之后改释义可直接走 PATCH 而不用再 upsert
      const addedEntryId =
        typeof data.lastEntryId === "string" && data.lastEntryId ? data.lastEntryId : null;
      setResult((prev) =>
        prev
          ? { ...prev, inWordList: true, localEntryId: addedEntryId ?? prev.localEntryId ?? null }
          : prev,
      );
    } catch {
      setError("加入词表失败");
    } finally {
      setBusy(false);
    }
  }

  async function addToWrongBook() {
    const e = result?.entry;
    if (!e?.word) return;
    setBusy(true);
    setWrongError(null);
    try {
      const res = await fetch(withBase("/api/wrong-book"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: e.word,
          glossZh: e.glossZh,
          ipa: e.ipa,
          pos: e.pos,
          example: e.example,
          phrases: e.phrases,
          related: e.related,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWrongError(data.error || "加入错词本失败");
        return;
      }
      setWrongAdded(true);
    } catch {
      setWrongError("加入错词本失败");
    } finally {
      setBusy(false);
    }
  }

  /** 保存成功后把新释义写回页面状态；若用户已查了别的词（word 不一致）则忽略 */
  function applySavedGloss(word: string, glossZh: string, entryId: string | null) {
    setResult((prev) => {
      if (!prev?.entry || prev.entry.word !== word) return prev;
      return {
        ...prev,
        inWordList: true,
        localEntryId: entryId ?? prev.localEntryId ?? null,
        entry: { ...prev.entry, id: entryId ?? prev.entry.id, glossZh },
      };
    });
  }

  function startEditGloss() {
    const e = result?.entry;
    if (!e || busy || savingGloss) return;
    setGlossDraft(e.glossZh ?? "");
    setGlossError(null);
    setGlossMsg(null);
    setEditingGloss(true);
  }

  function cancelEditGloss() {
    setEditingGloss(false);
    setGlossError(null);
    setGlossDraft(result?.entry?.glossZh ?? "");
  }

  /**
   * 保存「基本意思」：
   * - localEntryId 非空（词已在用户词表）→ PATCH /api/entries/{id}，只带 glossZh（该路由支持部分更新）
   * - 为空（外网词/不在词库）→ POST /api/entries/manual 新建，用返回的 lastEntryId 回填 localEntryId
   */
  async function saveGloss() {
    const e = result?.entry;
    if (!e || savingGloss) return;
    const next = glossDraft.trim();
    if (!next) {
      setGlossError("释义不能为空");
      return;
    }
    if (next === (e.glossZh ?? "").trim()) {
      // 没有改动：直接收起，不发请求
      setEditingGloss(false);
      setGlossError(null);
      return;
    }
    const word = e.word;
    const localEntryId = result?.localEntryId ?? null;
    setSavingGloss(true);
    setGlossError(null);
    setGlossMsg(null);
    try {
      if (localEntryId) {
        const res = await fetch(withBase(`/api/entries/${encodeURIComponent(localEntryId)}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ glossZh: next }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setGlossError(data.error || "保存释义失败");
          return; // 保留编辑态与用户输入
        }
        applySavedGloss(word, next, null);
      } else {
        const res = await fetch(withBase("/api/entries/manual"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listName: "查词收藏",
            word,
            glossZh: next,
            ipa: e.ipa,
            pos: e.pos,
            example: e.example,
            phrases: e.phrases,
            related: e.related,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          lastEntryId?: string | null;
        };
        if (!res.ok) {
          setGlossError(data.error || "保存释义失败");
          return; // 保留编辑态与用户输入
        }
        const newEntryId =
          typeof data.lastEntryId === "string" && data.lastEntryId ? data.lastEntryId : null;
        applySavedGloss(word, next, newEntryId);
      }
      // 保存期间用户可能已发起新查询：只在仍展示同一个词时才退出编辑态并提示
      if (currentWordRef.current === word) {
        setGlossDraft(next);
        setEditingGloss(false);
        setGlossMsg("已保存");
      }
    } catch {
      setGlossError("保存失败，请检查网络后重试");
    } finally {
      setSavingGloss(false);
    }
  }

  /** 保存成功后把新词性写回页面状态；若用户已查了别的词（word 不一致）则忽略 */
  function applySavedPos(word: string, pos: string, entryId: string | null) {
    setResult((prev) => {
      if (!prev?.entry || prev.entry.word !== word) return prev;
      return {
        ...prev,
        inWordList: true,
        localEntryId: entryId ?? prev.localEntryId ?? null,
        entry: { ...prev.entry, id: entryId ?? prev.entry.id, pos },
      };
    });
  }

  function startEditPos() {
    const e = result?.entry;
    if (!e || busy || savingPos) return;
    setPosDraft(e.pos ?? "");
    setPosError(null);
    setPosMsg(null);
    setEditingPos(true);
  }

  function cancelEditPos() {
    setEditingPos(false);
    setPosError(null);
    setPosDraft(result?.entry?.pos ?? "");
  }

  /**
   * 保存「词性」：
   * - localEntryId 非空 → PATCH /api/entries/{id}，body 仅 { pos }（该路由支持部分更新）
   * - 为空（外网词/尚未入库）→ POST /api/entries/manual，带上当前已有字段；
   *   缺失字段一律传 undefined（JSON 序列化后省略），绝不写空串覆盖服务端内容
   */
  async function savePos() {
    const e = result?.entry;
    if (!e || savingPos) return;
    const next = posDraft.trim();
    if (!next) {
      setPosError("词性不能为空");
      return; // 保留编辑态
    }
    if (next === (e.pos ?? "").trim()) {
      // 没有改动：直接收起，不发请求
      setEditingPos(false);
      setPosError(null);
      return;
    }
    const word = e.word;
    const localEntryId = result?.localEntryId ?? null;
    setSavingPos(true);
    setPosError(null);
    setPosMsg(null);
    try {
      if (localEntryId) {
        const res = await fetch(withBase(`/api/entries/${encodeURIComponent(localEntryId)}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pos: next }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setPosError(data.error || "保存词性失败");
          return; // 保留编辑态与用户输入
        }
        applySavedPos(word, next, null);
      } else {
        const res = await fetch(withBase("/api/entries/manual"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listName: "查词收藏",
            word,
            pos: next,
            glossZh: optionalText(e.glossZh),
            ipa: optionalText(e.ipa),
            example: optionalText(e.example),
            phrases: optionalList(e.phrases),
            related: optionalList(e.related),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          lastEntryId?: string | null;
        };
        if (!res.ok) {
          setPosError(data.error || "保存词性失败");
          return; // 保留编辑态与用户输入
        }
        const newEntryId =
          typeof data.lastEntryId === "string" && data.lastEntryId ? data.lastEntryId : null;
        applySavedPos(word, next, newEntryId);
      }
      // 保存期间用户可能已发起新查询：只在仍展示同一个词时才退出编辑态并提示
      if (currentWordRef.current === word) {
        setPosDraft(next);
        setEditingPos(false);
        setPosMsg("已保存");
      }
    } catch {
      setPosError("保存失败，请检查网络后重试");
    } finally {
      setSavingPos(false);
    }
  }

  const entry = result?.entry ?? null;
  const exampleLines = entry?.examples?.length
    ? entry.examples
    : entry?.example
      ? [entry.example]
      : [];
  const phrases = entry?.phrases ?? [];
  const synonyms = entry?.synonyms ?? [];
  const antonyms = entry?.antonyms ?? [];
  const related = entry?.related ?? [];
  const senses = (entry?.senses ?? []).slice(0, 9);
  // 本地词条没有 synonyms 字段，用 related 兜底；外网 related 是 synonyms 子集，避免重复展示
  const showRelated = synonyms.length === 0 && related.length > 0;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0">
        <h1 className="font-display text-xl">查词</h1>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          输入英语单词或中文释义后查询。支持中文或英文；先查本地词表，没有再外网补全。
        </p>
      </div>

      <div className="panel p-3 space-y-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <label className="label shrink-0 mb-0">查询（可编辑）</label>
          <input
            className="field flex-1 min-w-[10rem] text-sm"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            placeholder="输入英语单词或中文释义"
            onKeyDown={(e) => {
              if (e.key === "Enter") void runLookup(text);
            }}
          />
          <button
            type="button"
            className="btn-primary text-sm shrink-0"
            disabled={busy || !text.trim()}
            onClick={() => void runLookup(text)}
          >
            {busy ? "查询中…" : "确定查询"}
          </button>
        </div>
        {error && (
          <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] px-2 py-1 rounded-md">
            {error}
          </p>
        )}
        {addMsg && (
          <p className="text-xs text-[var(--ok)] bg-[var(--ok-soft)] px-2 py-1 rounded-md">{addMsg}</p>
        )}
      </div>

      {result && (
        <div className="panel p-3 space-y-2 min-h-0 flex-1 overflow-y-auto no-scrollbar">
          <p className="text-xs text-[var(--muted)]">
            查询「{result.query}」
            {result.source === "local"
              ? " · 本地词表"
              : result.source === "external"
                ? " · 外网补全"
                : ""}
            {result.fromAsr ? " · ASR" : ""}
          </p>
          {result.warnings?.length ? (
            <p className="text-xs text-[var(--muted)]">{result.warnings.join("；")}</p>
          ) : null}
          {!result.found || !result.entry ? (
            <p className="font-display text-lg">{result.message || "未找到"}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display min-w-0 break-words text-xl">{result.entry.word}</p>
                {/* 词性：默认只读展示 + 紧凑「编辑」；编辑态用 datalist 可输入下拉 */}
                {editingPos ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <input
                      className="field w-32 shrink-0 px-2 py-0.5 text-xs"
                      value={posDraft}
                      list={POS_OPTIONS_ID}
                      autoFocus
                      disabled={savingPos}
                      placeholder="如 noun."
                      aria-label="编辑词性"
                      onChange={(ev) => setPosDraft(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Escape") {
                          ev.preventDefault();
                          cancelEditPos();
                          return;
                        }
                        if (ev.key === "Enter") {
                          ev.preventDefault();
                          void savePos();
                        }
                      }}
                    />
                    <datalist id={POS_OPTIONS_ID}>
                      {POS_OPTIONS.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="btn-primary shrink-0 px-2 py-1 text-xs"
                      disabled={savingPos}
                      onClick={() => void savePos()}
                    >
                      {savingPos ? "保存中…" : "保存"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary shrink-0 px-2 py-1 text-xs"
                      disabled={savingPos}
                      onClick={cancelEditPos}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-xs text-[var(--muted)]">
                      {result.entry.pos || "（未标词性）"}
                    </span>
                    <button
                      type="button"
                      className="badge shrink-0 cursor-pointer text-xs text-[var(--teal)] hover:bg-[var(--teal-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy || savingPos}
                      aria-label="编辑词性"
                      onClick={startEditPos}
                    >
                      编辑
                    </button>
                    {posMsg && <span className="shrink-0 text-xs text-[var(--ok)]">{posMsg}</span>}
                  </div>
                )}
                <button
                  type="button"
                  className="badge shrink-0 cursor-pointer text-[var(--teal)] hover:bg-[var(--teal-soft)]"
                  aria-label="朗读单词"
                  onClick={() => void speakWord(result.entry?.word ?? "")}
                >
                  🔊 {speaking ? "朗读中…" : "朗读"}
                </button>
              </div>
              {posError && (
                <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] px-2 py-1 rounded-md">
                  {posError}
                </p>
              )}
              {result.entry.ipa && <p className="text-xs text-[var(--muted)]">{result.entry.ipa}</p>}
              {editingGloss ? (
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <textarea
                      className="field min-h-[2.5rem] max-h-24 min-w-0 flex-1 resize-none text-sm leading-relaxed"
                      rows={2}
                      value={glossDraft}
                      autoFocus
                      disabled={savingGloss}
                      aria-label="编辑基本意思（中文释义）"
                      onChange={(ev) => setGlossDraft(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Escape") {
                          ev.preventDefault();
                          cancelEditGloss();
                          return;
                        }
                        if (ev.key === "Enter" && !ev.shiftKey) {
                          ev.preventDefault();
                          void saveGloss();
                        }
                      }}
                    />
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        className="btn-primary px-2 py-1 text-xs"
                        disabled={savingGloss}
                        onClick={() => void saveGloss()}
                      >
                        {savingGloss ? "保存中…" : "保存"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        disabled={savingGloss}
                        onClick={cancelEditGloss}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                  {glossError && (
                    <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] px-2 py-1 rounded-md">
                      {glossError}
                    </p>
                  )}
                  <p className="text-[11px] text-[var(--muted)]">回车保存，Shift+回车换行，Esc 取消</p>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 whitespace-pre-line break-words text-sm leading-relaxed">
                    {result.entry.glossZh || (
                      <span className="text-[var(--muted)]">（暂无中文释义，可点「编辑」补充）</span>
                    )}
                  </p>
                  {glossMsg && (
                    <span className="shrink-0 text-xs text-[var(--ok)]">{glossMsg}</span>
                  )}
                  <button
                    type="button"
                    className="badge shrink-0 cursor-pointer text-[var(--teal)] hover:bg-[var(--teal-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy || savingGloss}
                    onClick={startEditGloss}
                  >
                    编辑
                  </button>
                </div>
              )}
              {(senses.length > 0 ||
                exampleLines.length > 0 ||
                phrases.length > 0 ||
                synonyms.length > 0 ||
                antonyms.length > 0 ||
                showRelated) && (
                <div className="no-scrollbar max-h-40 shrink-0 space-y-1 overflow-y-auto text-xs">
                  {senses.length > 0 && (
                    <div>
                      <span className="text-[var(--muted)]">义项：</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {senses.map((sense, i) => (
                          <li key={`${i}-${sense.defEn}`} className="flex gap-1 leading-snug">
                            {sense.pos && (
                              <span className="shrink-0 text-[var(--muted)]">{sense.pos}</span>
                            )}
                            <span>{sense.defZh || sense.defEn}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {exampleLines.length > 0 && (
                    <div>
                      <span className="text-[var(--muted)]">例句：</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {exampleLines.map((line, i) => (
                          <li
                            key={`${i}-${line}`}
                            className="border-l-2 border-[var(--teal)] pl-2 leading-snug"
                          >
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {phrases.length > 0 && (
                    <p>
                      <span className="text-[var(--muted)]">常用词组：</span>
                      {phrases.join(" · ")}
                    </p>
                  )}
                  {synonyms.length > 0 && (
                    <p>
                      <span className="text-[var(--muted)]">近义词：</span>
                      {synonyms.join(" · ")}
                    </p>
                  )}
                  {antonyms.length > 0 && (
                    <p>
                      <span className="text-[var(--muted)]">反义词：</span>
                      {antonyms.join(" · ")}
                    </p>
                  )}
                  {showRelated && (
                    <p>
                      <span className="text-[var(--muted)]">关联词：</span>
                      {related.join(" · ")}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {result.inWordList ? (
                  <p className="flex-1 text-xs text-[var(--muted)] bg-[var(--ok-soft)] px-2 py-1 rounded-md">
                    该词已在你的词表中，无需重复加入
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn-primary min-w-[8rem] flex-1 text-sm"
                    disabled={busy}
                    onClick={() => void addToList()}
                  >
                    加入词表
                  </button>
                )}
                {/* 错词本与词表相互独立：已在词表里也允许加入错词本 */}
                <button
                  type="button"
                  className="btn-secondary shrink-0 text-sm"
                  disabled={busy || wrongAdded}
                  onClick={() => void addToWrongBook()}
                >
                  {wrongAdded ? "已加入错词本" : "加入错词本"}
                </button>
              </div>
              {wrongError && (
                <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] px-2 py-1 rounded-md">
                  {wrongError}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
