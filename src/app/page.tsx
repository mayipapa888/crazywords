"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HeroArt, SparkArt } from "@/components/Illustrations";

type QueueItem = {
  entryId: string;
  word: string;
  glossZh: string | null;
  pos: string | null;
  ipa?: string | null;
  reason: string;
  mode: string;
};

type QueueResp = {
  date: string;
  goalN: number;
  items: QueueItem[];
  reviewDay: boolean;
  clozeEnabled: boolean;
  tomorrowDueCount?: number;
};

type Me = {
  dailyGoalDefault: number;
  clozeEnabled: boolean;
};

/** /api/entries 返回的词条：卡片只用到这几个字段 */
type EntryDetail = {
  id: string;
  word: string;
  ipa: string | null;
  pos: string | null;
  glossZh: string | null;
  example: string | null;
};

function reasonLabel(reason: string): string {
  if (reason === "due") return "到期复习";
  if (reason === "wrong") return "错词";
  return "新词";
}

function modeLabel(mode: string): string {
  return mode === "gloss" ? "释义→拼写" : "单词→中文";
}

/** TTS 拿不到音频时的降级：浏览器内置语音；失败静默 */
function speakWithSynthesis(word: string) {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  } catch {
    // 浏览器语音也不可用：静默
  }
}

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [queue, setQueue] = useState<QueueResp | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 卡片视图：null 表示关闭，否则是 queue.items 里的下标（覆盖全部 items） */
  const [cardIndex, setCardIndex] = useState<number | null>(null);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 朗读代际：切卡 / 关闭 / 重播时自增，旧请求与旧音频自行失效 */
  const speakGenRef = useRef(0);
  /** 自动朗读去重：记录最近一次朗读过的词（小写），同一个词只自动读一次 */
  const spokenWordRef = useRef<string | null>(null);
  /** 词条缓存：来回切卡不重复请求 */
  const detailCacheRef = useRef<Map<string, EntryDetail | null>>(new Map());

  const items = queue?.items ?? [];
  const total = items.length;
  const activeItem = cardIndex !== null ? items[cardIndex] ?? null : null;
  const activeWord = activeItem?.word ?? null;
  const cardPos = cardIndex ?? 0;

  /* ---------------- 首页数据 ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [m, q, e, w] = await Promise.allSettled([
        fetch("/api/me").then((r) => r.json() as Promise<Me>),
        fetch("/api/queue/today").then((r) => r.json() as Promise<QueueResp>),
        fetch("/api/entries").then((r) => r.json() as Promise<{ entries?: unknown[] }>),
        fetch("/api/wrong-book").then((r) => r.json() as Promise<{ items?: unknown[] }>),
      ]);
      if (cancelled) return;
      if (m.status === "fulfilled") setMe(m.value);
      if (q.status === "fulfilled") setQueue(q.value);
      else setLoadError("今日队列加载失败，请刷新重试");
      if (e.status === "fulfilled") setEntryCount(e.value.entries?.length ?? 0);
      if (w.status === "fulfilled") setWrongCount(w.value.items?.length ?? 0);
    })().catch(() => {
      if (!cancelled) setLoadError("首页数据加载失败，请刷新重试");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- 卡片词条按需补全 ---------------- */
  useEffect(() => {
    if (!activeWord) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }
    const word = activeWord;
    const cached = detailCacheRef.current.get(word);
    if (cached !== undefined) {
      setDetail(cached);
      setDetailLoading(false);
      setDetailError(cached ? null : "词库中没有找到该词的完整词条，仍可朗读");
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/entries?q=${encodeURIComponent(word)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { entries?: EntryDetail[] };
        const list = Array.isArray(data.entries) ? data.entries : [];
        const lowered = word.toLowerCase();
        // 优先精确匹配，否则取接口返回的第一条
        const exact = list.find((it) => it.word?.toLowerCase() === lowered) ?? null;
        const first: EntryDetail | null = list.length > 0 ? list[0] : null;
        const entry: EntryDetail | null = exact ?? first;
        detailCacheRef.current.set(word, entry);
        if (cancelled) return;
        setDetail(entry);
        setDetailError(entry ? null : "词库中没有找到该词的完整词条，仍可朗读");
      } catch {
        if (cancelled) return;
        setDetail(null);
        setDetailError("词条加载失败，仍可朗读");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWord]);

  /* ---------------- 朗读 ---------------- */
  const stopSpeech = useCallback(() => {
    speakGenRef.current += 1;
    const audio = audioRef.current;
    audioRef.current = null;
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

  const speakWord = useCallback(
    async (rawWord: string) => {
      const word = rawWord.trim();
      if (!word) return;
      stopSpeech();
      // 手动重播也算「读过这个词」，避免自动朗读随后重复触发
      spokenWordRef.current = word.toLowerCase();
      const gen = speakGenRef.current;
      try {
        const res = await fetch("/api/speech/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: word, language: "en-US" }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          audioBase64?: string;
          mimeType?: string;
        };
        if (speakGenRef.current !== gen) return;
        if (res.ok && data.audioBase64) {
          const audio = new Audio(
            `data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`,
          );
          audioRef.current = audio;
          audio.onended = () => {
            if (audioRef.current === audio) audioRef.current = null;
          };
          audio.onerror = () => {
            if (audioRef.current === audio) audioRef.current = null;
            if (speakGenRef.current === gen) speakWithSynthesis(word);
          };
          try {
            await audio.play();
          } catch {
            if (audioRef.current === audio) audioRef.current = null;
            if (speakGenRef.current === gen) speakWithSynthesis(word);
          }
          return;
        }
        speakWithSynthesis(word);
      } catch {
        // 网络 / 接口失败：静默降级到浏览器语音，不打扰卡片
        if (speakGenRef.current === gen) speakWithSynthesis(word);
      }
    },
    [stopSpeech],
  );

  /** 卡片打开 / 切到新词时自动朗读一次；同词不重复 */
  useEffect(() => {
    if (!activeWord) return;
    const key = activeWord.toLowerCase();
    if (spokenWordRef.current === key) return;
    spokenWordRef.current = key;
    void speakWord(activeWord);
  }, [activeWord, speakWord]);

  /** 卸载时停掉音频与合成音 */
  useEffect(
    () => () => {
      stopSpeech();
    },
    [stopSpeech],
  );

  /* ---------------- 卡片开关 / 翻页 ---------------- */
  const openCard = useCallback((index: number) => {
    // 重新打开同一张卡也允许自动朗读一次
    spokenWordRef.current = null;
    setCardIndex(index);
  }, []);

  const closeCard = useCallback(() => {
    stopSpeech();
    spokenWordRef.current = null;
    setCardIndex(null);
  }, [stopSpeech]);

  const stepCard = useCallback(
    (delta: number) => {
      setCardIndex((cur) => {
        if (cur === null) return null;
        const max = Math.max(0, total - 1);
        const next = cur + delta;
        return next < 0 || next > max ? cur : next;
      });
    },
    [total],
  );

  /* ---------------- 键盘：← → 切换，Esc 关闭 ---------------- */
  useEffect(() => {
    if (cardIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCard();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepCard(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepCard(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cardIndex, closeCard, stepCard]);

  return (
    <>
      <div className="flex h-full flex-col gap-3">
        <section className="anim-fade-up relative shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--ink)] px-5 py-5 text-[var(--paper)] md:px-8">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                "radial-gradient(600px 280px at 80% 20%, #14c8aa, transparent), radial-gradient(400px 220px at 10% 90%, #ff8a4ccc, transparent)",
            }}
          />
          <div
            className="anim-gradient pointer-events-none absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(115deg, #8b5cf6 0%, #22d3ee 34%, #ff8a4c 66%, #8b5cf6 100%)",
            }}
          />
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-56 items-center justify-center opacity-70 md:flex md:w-64">
            <HeroArt className="anim-float h-full w-auto" />
          </div>
          <div className="relative max-w-3xl space-y-2 md:pr-52">
            <p className="font-display text-3xl tracking-tight md:text-4xl">CrazyWords</p>
            <p className="whitespace-nowrap text-base leading-relaxed text-white/85">
              跬步不辍，终至千里；微光不息，自成星河！
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href="/dictation" className="btn-accent">
                开始今日听写
              </Link>
              <Link
                href="/lookup"
                className="btn-secondary border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                去查词
              </Link>
            </div>
          </div>
        </section>

        <section className="grid shrink-0 gap-3 sm:grid-cols-3">
          <div
            className="panel stat-card anim-fade-up p-3"
            style={{ animationDelay: "60ms" }}
          >
            <div className="relative z-10 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="label">词库</p>
                <p className="stat-value text-[var(--teal)]">{entryCount}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">条词条</p>
              </div>
              <SparkArt className="h-5 w-5 shrink-0 opacity-80" />
            </div>
          </div>
          <div
            className="panel stat-card stat-card-teal anim-fade-up p-3"
            style={{ animationDelay: "120ms" }}
          >
            <div className="relative z-10 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="label">今日队列</p>
                <p className="stat-value">{queue?.items.length ?? "—"}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  目标 {me?.dailyGoalDefault ?? "—"}
                  {queue?.reviewDay ? " · 复习日" : ""}
                </p>
              </div>
              <SparkArt className="h-5 w-5 shrink-0 opacity-80" />
            </div>
          </div>
          <div
            className="panel stat-card stat-card-warm anim-fade-up p-3"
            style={{ animationDelay: "180ms" }}
          >
            <div className="relative z-10 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="label">活跃错词</p>
                <p className="stat-value text-[var(--accent)]">{wrongCount}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">错词本</p>
              </div>
              <SparkArt className="h-5 w-5 shrink-0 opacity-80" />
            </div>
          </div>
        </section>

        <section className="panel no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="font-display text-lg">今日需记忆（艾宾浩斯）</h2>
              <span className="text-xs text-[var(--muted)]">
                {queue
                  ? `明日复习 ${queue.tomorrowDueCount ?? 0} 个`
                  : "按 1·2·4·7·15·30·60 天曲线安排"}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-xs text-[var(--muted)] sm:inline">点击单词看卡片</span>
              <Link href="/dictation" className="text-sm text-[var(--teal)]">
                去听写 →
              </Link>
            </div>
          </div>
          {!queue ? (
            loadError ? (
              <p className="text-sm text-[var(--accent)]">{loadError}</p>
            ) : (
              <p className="text-sm text-[var(--muted)]">加载中…</p>
            )
          ) : queue.items.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              队列为空。请先到「词库维护」导入 CSV，或确认词条有中文释义。
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {queue.items.slice(0, 8).map((item, index) => (
                <li key={item.entryId}>
                  <button
                    type="button"
                    onClick={() => openCard(index)}
                    className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left transition hover:bg-[var(--chip)]"
                    title={`以卡片查看 ${item.word}`}
                  >
                    <span className="w-36 shrink-0 truncate font-medium">{item.word}</span>
                    <span className="hidden w-20 shrink-0 truncate text-xs text-[var(--muted)] md:block">
                      {item.pos || "—"}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate text-xs text-[var(--muted)] md:block">
                      {item.glossZh || "—"}
                    </span>
                    <span className="ml-auto flex shrink-0 gap-2">
                      <span className="badge">{reasonLabel(item.reason)}</span>
                      <span className="badge">{modeLabel(item.mode)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {activeItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`单词卡片：${activeItem.word}`}
          onClick={closeCard}
        >
          <div
            className="panel flex h-[min(88vh,30rem)] w-full max-w-lg flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge">{reasonLabel(activeItem.reason)}</span>
                <span className="badge">{modeLabel(activeItem.mode)}</span>
              </div>
              <button
                type="button"
                onClick={() => void speakWord(activeItem.word)}
                className="shrink-0 rounded-md border border-[var(--line)] px-2 py-1 text-lg leading-none transition hover:bg-[var(--chip)]"
                aria-label="朗读单词"
                title="朗读单词"
              >
                🔊
              </button>
            </div>

            <div
              className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3"
              aria-busy={detailLoading}
            >
              <p className="font-display break-words text-3xl leading-tight tracking-tight">
                {activeItem.word}
              </p>

              {detailLoading ? (
                <div className="space-y-2" aria-hidden="true">
                  <div className="h-3 w-24 animate-pulse rounded bg-[var(--chip)]" />
                  <div className="h-3 w-16 animate-pulse rounded bg-[var(--chip)]" />
                  <div className="h-3 w-full animate-pulse rounded bg-[var(--chip)]" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--chip)]" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm text-[var(--muted)]">
                      音标 {detail?.ipa || "—"}
                    </span>
                    <span className="badge">{detail?.pos || "词性 —"}</span>
                  </div>
                  <div>
                    <p className="label mb-0.5">中文释义</p>
                    <p className="text-base leading-relaxed">{detail?.glossZh || "—"}</p>
                  </div>
                  <div>
                    <p className="label mb-0.5">例句</p>
                    <p className="text-sm leading-relaxed">{detail?.example || "—"}</p>
                  </div>
                  {detailError && (
                    <p className="text-xs text-[var(--accent)]">{detailError}</p>
                  )}
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--line)] px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => stepCard(-1)}
                  disabled={cardPos <= 0}
                  className="btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← 上一张
                </button>
                <p className="text-xs text-[var(--muted)]">
                  第 {cardPos + 1} / {total} 张
                </p>
                <button
                  type="button"
                  onClick={() => stepCard(1)}
                  disabled={cardPos >= total - 1}
                  className="btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                >
                  下一张 →
                </button>
              </div>
              <p className="mt-1 text-center text-[11px] text-[var(--muted)]">
                ← → 切换 · Esc 关闭
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
