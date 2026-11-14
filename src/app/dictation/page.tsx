"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicGate } from "@/components/MicGate";
import { extractLemmaFromTranscript } from "@/lib/speech/extract-lemma";
import { extractChineseFromTranscript } from "@/lib/speech/extract-meaning";
import { playFailChime, playSuccessChime } from "@/lib/speech/play-sfx";
import { RealtimeAsrSession } from "@/lib/speech/realtime-client";

type DictationMode = "gloss" | "meaning";

type QueueItem = {
  entryId: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  mode: DictationMode | "cloze";
  reason: string;
};

type Feedback = {
  mode?: DictationMode;
  spellingOk: boolean;
  pronunciationOk: boolean;
  meaningOk?: boolean | null;
  overallOk: boolean;
  asrTranscript: string | null;
  extractedSpelling?: string | null;
  extractedMeaning?: string | null;
  answer: {
    word: string;
    glossZh: string | null;
    ipa: string | null;
    example: string | null;
  };
};

type Timers = {
  autoSubmitSeconds: number;
  autoStartRecordSeconds: number;
  autoNextWordSeconds: number;
};

type Phase = "idle" | "tts" | "wait-record" | "recording" | "feedback";

function playUtterance(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
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
  });
}

function playAudioBase64(audioBase64: string, mimeType?: string): Promise<void> {
  return new Promise((resolve) => {
    const src = `data:${mimeType || "audio/mpeg"};base64,${audioBase64}`;
    const audio = new Audio(src);
    const done = () => resolve();
    audio.onended = done;
    audio.onerror = done;
    void audio.play().then(undefined, done);
  });
}

/**
 * 听写 TTS 正文：只返回要朗读的原文。
 * 模式 A = 中文释义；模式 B = 英文单词。禁止任何「请听写/请根据…」前后缀。
 */
function dictationTtsText(item: QueueItem): { text: string; lang: string } {
  const m =
    item.mode === "meaning" || item.mode === "cloze" ? "meaning" : "gloss";
  if (m === "meaning") {
    return { text: item.word.trim(), lang: "en-US" };
  }
  let gloss = (item.glossZh || "").trim();
  // 若词条或旧逻辑误带提示语，剥掉常见前缀（仍以释义原文为准）
  gloss = gloss
    .replace(
      /^(请根据中文释义拼写并朗读单词[。．.\s]*|请根据释义拼写并朗读[：:。．.\s]*|请听写[：:。．.\s]*|请说出这个单词的中文意思[。．.\s]*)+/u,
      "",
    )
    .trim();
  return { text: gloss, lang: "zh-CN" };
}

export default function DictationPage() {
  const [micOk, setMicOk] = useState(false);
  /** 用户点选的听写模式（页面按钮，不依赖设置开关） */
  const [selectedMode, setSelectedMode] = useState<DictationMode>("gloss");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [spelling, setSpelling] = useState("");
  const [meaningText, setMeaningText] = useState("");
  const [liveText, setLiveText] = useState("");
  const [recording, setRecording] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttsNote, setTtsNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [timers, setTimers] = useState<Timers>({
    autoSubmitSeconds: 15,
    autoStartRecordSeconds: 10,
    autoNextWordSeconds: 30,
  });
  const [countdown, setCountdown] = useState<string | null>(null);

  const asrRef = useRef<RealtimeAsrSession | null>(null);
  const submitLock = useRef(false);
  const wordGen = useRef(0);
  const liveTextRef = useRef("");
  const spellingRef = useRef("");
  const meaningRef = useRef("");
  const startRealtimeRef = useRef<() => Promise<void>>(async () => undefined);
  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const timersRef = useRef(timers);
  timersRef.current = timers;

  const current = items[index];
  const mode: DictationMode = current
    ? current.mode === "meaning" || current.mode === "cloze"
      ? "meaning"
      : "gloss"
    : selectedMode;

  const clearTimers = useCallback(() => {
    if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    autoStartTimer.current = null;
    autoSubmitTimer.current = null;
    autoNextTimer.current = null;
    tickTimer.current = null;
    setCountdown(null);
  }, []);

  const speakEntry = useCallback(async (item: QueueItem): Promise<void> => {
    const { text, lang } = dictationTtsText(item);
    if (!text) {
      setTtsNote("无可播报文本");
      return;
    }
    try {
      const res = await fetch("/api/speech/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "TTS 失败";
        setTtsNote(`TTS 失败：${msg}`);
        setError(msg);
        return;
      }
      setTtsNote(
        data.mock
          ? `TTS mock（${data.provider}）· 仅朗读原文`
          : `阿里云 TTS · 仅朗读原文`,
      );
      if (data.audioBase64) {
        await playAudioBase64(data.audioBase64, data.mimeType);
        return;
      }
      if (data.mock) {
        await playUtterance(text, lang);
        return;
      }
      setError("TTS 未返回音频。aliyun 模式必须使用阿里云语音合成。");
      setTtsNote("TTS 未返回音频");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "TTS 调用失败";
      setTtsNote(msg);
      setError(msg);
    }
  }, []);

  async function startSession() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    setIndex(0);
    setSpelling("");
    setMeaningText("");
    setLiveText("");
    liveTextRef.current = "";
    spellingRef.current = "";
    meaningRef.current = "";
    setPhase("idle");
    try {
      const [meRes, sessRes] = await Promise.all([
        fetch("/api/me"),
        fetch("/api/sessions", { method: "POST" }),
      ]);
      const me = await meRes.json();
      const data = await sessRes.json();
      if (meRes.ok) {
        setTimers({
          autoSubmitSeconds: me.autoSubmitSeconds ?? 15,
          autoStartRecordSeconds: me.autoStartRecordSeconds ?? 10,
          autoNextWordSeconds: me.autoNextWordSeconds ?? 30,
        });
      }
      if (!sessRes.ok) {
        setError(data.error || "无法开始会话");
        return;
      }
      // 用户点选的模式覆盖队列里的 mode
      const rawItems = (data.items || []) as QueueItem[];
      setSessionId(data.sessionId);
      setItems(rawItems.map((it) => ({ ...it, mode: selectedMode })));
    } finally {
      setBusy(false);
    }
  }

  const stopAsr = useCallback(async () => {
    const s = asrRef.current;
    asrRef.current = null;
    if (s) await s.stop().catch(() => undefined);
    setRecording(false);
  }, []);

  const nextWord = useCallback(() => {
    clearTimers();
    setFeedback(null);
    setSpelling("");
    setMeaningText("");
    setLiveText("");
    liveTextRef.current = "";
    spellingRef.current = "";
    meaningRef.current = "";
    setPhase("idle");
    setIndex((prev) => {
      const next = prev + 1;
      if (next >= items.length) {
        if (sessionId) {
          void fetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
        }
      }
      return next;
    });
  }, [clearTimers, items.length, sessionId]);

  const submitAttempt = useCallback(
    async (transcriptOverride?: string) => {
      if (!sessionId || !current || submitLock.current || feedback) return;
      submitLock.current = true;
      setBusy(true);
      setError(null);
      clearTimers();
      try {
        const live =
          transcriptOverride ??
          liveTextRef.current ??
          asrRef.current?.transcript ??
          "";
        await stopAsr();
        const m =
          current.mode === "meaning" || current.mode === "cloze"
            ? "meaning"
            : "gloss";
        const spellingInput =
          m === "gloss"
            ? spellingRef.current.trim() ||
              extractLemmaFromTranscript(live, current.word)
            : meaningRef.current.trim() || extractChineseFromTranscript(live);

        if (!live.trim() && !spellingInput) {
          setError("未获得识别文本。请开口作答，或检查麦克风 / 实时识别配置。");
          setPhase("wait-record");
          // 无「立即开始录音」按钮：自动重新走开录计时
          const mEmpty =
            current.mode === "meaning" || current.mode === "cloze"
              ? "meaning"
              : "gloss";
          if (mEmpty === "meaning") {
            setTimeout(() => void startRealtimeRef.current(), 400);
          } else {
            let left = timersRef.current.autoStartRecordSeconds;
            setCountdown(`${left}s 后自动开始录音`);
            tickTimer.current = setInterval(() => {
              left -= 1;
              if (left <= 0) {
                if (tickTimer.current) clearInterval(tickTimer.current);
                setCountdown(null);
              } else {
                setCountdown(`${left}s 后自动开始录音`);
              }
            }, 1000);
            autoStartTimer.current = setTimeout(() => {
              void startRealtimeRef.current();
            }, timersRef.current.autoStartRecordSeconds * 1000);
          }
          return;
        }

        const res = await fetch(`/api/sessions/${sessionId}/attempt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: current.entryId,
            mode: m,
            spellingInput,
            realtimeTranscript: live || spellingInput,
          }),
        });
        const data = (await res.json()) as Feedback & { error?: string };
        if (!res.ok) {
          setError(data.error || "提交失败");
          setPhase("wait-record");
          return;
        }

        if (m === "gloss") {
          setSpelling(spellingInput);
          spellingRef.current = spellingInput;
        } else {
          setMeaningText(spellingInput);
          meaningRef.current = spellingInput;
        }

        if (data.overallOk) {
          // 正确：绿勾区 + 叮咚，随即下一词
          playSuccessChime();
          setFeedback(data);
          setPhase("feedback");
          setTimeout(() => {
            setFeedback(null);
            nextWord();
          }, 700);
          return;
        }

        // 错误：惋惜音 + 红叉，仅可重试当前词
        playFailChime();
        setFeedback(data);
        setPhase("feedback");
      } finally {
        setBusy(false);
        submitLock.current = false;
      }
    },
    [sessionId, current, feedback, clearTimers, stopAsr, nextWord],
  );

  const startRealtime = useCallback(async () => {
    if (!current || recording || feedback) return;
    setError(null);
    setLiveText("");
    liveTextRef.current = "";
    const m =
      current.mode === "meaning" || current.mode === "cloze"
        ? "meaning"
        : "gloss";
    try {
      const session = new RealtimeAsrSession(
        {
          onPartial: (t) => {
            liveTextRef.current = t;
            setLiveText(t);
            if (m === "gloss") {
              const lemma = extractLemmaFromTranscript(t, current.word);
              if (lemma) {
                spellingRef.current = lemma;
                setSpelling(lemma);
              }
            } else {
              const zh = extractChineseFromTranscript(t);
              if (zh) {
                meaningRef.current = zh;
                setMeaningText(zh);
              }
            }
          },
          onFinal: (t) => {
            liveTextRef.current = t;
            setLiveText(t);
            if (m === "gloss") {
              const lemma = extractLemmaFromTranscript(t, current.word);
              if (lemma) {
                spellingRef.current = lemma;
                setSpelling(lemma);
              }
            } else {
              const zh = extractChineseFromTranscript(t);
              if (zh) {
                meaningRef.current = zh;
                setMeaningText(zh);
              }
            }
          },
          onError: (e) => setError(e.message),
        },
        {
          language: m === "meaning" ? "zh" : "en",
          targetText:
            m === "meaning"
              ? extractChineseFromTranscript(current.glossZh || "") ||
                current.glossZh ||
                undefined
              : current.word,
        },
      );
      asrRef.current = session;
      await session.start();
      setRecording(true);
      setPhase("recording");

      let left = timers.autoSubmitSeconds;
      setCountdown(`录音中，${left}s 后自动判定`);
      tickTimer.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (tickTimer.current) clearInterval(tickTimer.current);
          setCountdown(null);
        } else {
          setCountdown(`录音中，${left}s 后自动判定`);
        }
      }, 1000);
      autoSubmitTimer.current = setTimeout(() => {
        void submitAttempt();
      }, timers.autoSubmitSeconds * 1000);
    } catch (e) {
      setRecording(false);
      setMicOk(false);
      setPhase("wait-record");
      setError(e instanceof Error ? e.message : "无法开始实时识别");
    }
  }, [current, recording, feedback, timers.autoSubmitSeconds, submitAttempt]);

  startRealtimeRef.current = startRealtime;

  const beginTimersAfterTts = useCallback(
    (item: QueueItem) => {
      const m =
        item.mode === "meaning" || item.mode === "cloze" ? "meaning" : "gloss";
      if (m === "meaning") {
        setPhase("wait-record");
        void startRealtime();
        return;
      }

      let left = timers.autoStartRecordSeconds;
      setPhase("wait-record");
      setCountdown(`${left}s 后自动开始录音`);
      tickTimer.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (tickTimer.current) clearInterval(tickTimer.current);
          setCountdown(null);
        } else {
          setCountdown(`${left}s 后自动开始录音`);
        }
      }, 1000);

      autoStartTimer.current = setTimeout(() => {
        void startRealtime();
      }, timers.autoStartRecordSeconds * 1000);
    },
    [timers.autoStartRecordSeconds, startRealtime],
  );

  // 进入新题：先 TTS，结束后再计时（模式 A）/ 直接开录（模式 B）
  useEffect(() => {
    if (!sessionId || !current || feedback || index >= items.length) return;

    const gen = ++wordGen.current;
    clearTimers();
    setLiveText("");
    liveTextRef.current = "";
    setSpelling("");
    spellingRef.current = "";
    setMeaningText("");
    meaningRef.current = "";
    setError(null);
    submitLock.current = false;
    setPhase("tts");
    setCountdown("正在播报…");

    void (async () => {
      await speakEntry(current);
      if (wordGen.current !== gen) return;
      beginTimersAfterTts(current);
    })();

    return () => {
      wordGen.current += 1;
      clearTimers();
      void stopAsr();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, index, current?.entryId]);

  const retryCurrent = useCallback(() => {
    if (!current) return;
    clearTimers();
    wordGen.current += 1;
    const gen = ++wordGen.current;
    setFeedback(null);
    setError(null);
    setLiveText("");
    liveTextRef.current = "";
    setSpelling("");
    spellingRef.current = "";
    setMeaningText("");
    meaningRef.current = "";
    submitLock.current = false;
    setPhase("tts");
    setCountdown("正在播报…");
    void (async () => {
      await speakEntry(current);
      if (wordGen.current !== gen) return;
      beginTimersAfterTts(current);
    })();
  }, [current, clearTimers, speakEntry, beginTimersAfterTts]);

  useEffect(() => {
    return () => {
      clearTimers();
      void stopAsr();
    };
  }, [clearTimers, stopAsr]);

  if (!micOk) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-3xl">听写</h1>
        <MicGate onGranted={() => setMicOk(true)} />
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="space-y-6 max-w-lg">
        <h1 className="font-display text-3xl">听写</h1>
        <div className="panel p-6 space-y-5">
          <p className="text-[var(--muted)] text-sm">
            请选择本轮模式。答对叮咚后进入下一词；答错红叉仅可重试本词。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className={`rounded-lg border px-4 py-4 text-left transition ${
                selectedMode === "gloss"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] hover:border-[var(--accent)]"
              }`}
              onClick={() => setSelectedMode("gloss")}
            >
              <span className="font-display text-lg block">模式 A</span>
              <span className="text-sm text-[var(--muted)]">中文 → 拼写朗读</span>
            </button>
            <button
              type="button"
              className={`rounded-lg border px-4 py-4 text-left transition ${
                selectedMode === "meaning"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] hover:border-[var(--accent)]"
              }`}
              onClick={() => setSelectedMode("meaning")}
            >
              <span className="font-display text-lg block">模式 B</span>
              <span className="text-sm text-[var(--muted)]">单词 → 说中文</span>
            </button>
          </div>

          {error && (
            <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
              {error}
            </p>
          )}
          <button type="button" className="btn-primary w-full" disabled={busy} onClick={startSession}>
            {busy
              ? "准备中…"
              : selectedMode === "gloss"
                ? "开始模式 A 听写"
                : "开始模式 B 听写"}
          </button>
          <p className="text-xs text-[var(--muted)]">
            开录 / 自动判定秒数可在「设置」调整。模式 A 在中文播报结束后再计时开录。
          </p>
        </div>
      </div>
    );
  }

  if (index >= items.length) {
    return (
      <div className="panel p-8 max-w-lg space-y-4">
        <h1 className="font-display text-3xl">本轮完成</h1>
        <p className="text-[var(--muted)]">共完成 {items.length} 词。</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setSessionId(null);
            setItems([]);
            setIndex(0);
          }}
        >
          返回选模式
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">听写</h1>
          <p className="text-[var(--muted)] text-sm mt-1">
            {index + 1} / {items.length}
            <span className="badge ml-2">
              {mode === "gloss" ? "模式 A · 中文→拼写" : "模式 B · 单词→中文"}
            </span>
          </p>
        </div>
      </div>

      <div className="panel p-6 space-y-5">
        {mode === "gloss" ? (
          <div>
            <p className="label">中文释义</p>
            <p className="font-display text-2xl leading-snug">{current.glossZh}</p>
          </div>
        ) : (
          <div>
            <p className="label">单词</p>
            <p className="font-display text-3xl tracking-wide">{current.word}</p>
            {current.ipa && (
              <p className="text-[var(--muted)] mt-1">{current.ipa}</p>
            )}
          </div>
        )}

        {ttsNote && (
          <p className="text-xs text-[var(--muted)] bg-[var(--chip)] rounded-md px-3 py-2">
            {ttsNote}
            {phase === "tts" ? " · 播报中" : ""}
          </p>
        )}
        {countdown && (
          <p className="text-sm text-[var(--accent)] bg-[var(--accent-soft)] rounded-md px-3 py-2">
            {countdown}
          </p>
        )}

        <section className="rounded-lg border border-[var(--line)] bg-[var(--chip)]/40 p-4 space-y-2">
          <p className="label mb-0">实时识别（累计）</p>
          <p className="min-h-[4.5rem] font-display text-xl leading-relaxed whitespace-pre-wrap">
            {liveText ||
              (phase === "tts"
                ? "等待播报结束…"
                : recording
                  ? "正在听…"
                  : "等待开录…")}
          </p>
        </section>

        <section className="rounded-lg border border-[var(--line)] p-4 space-y-3">
          <p className="label mb-0">判定区</p>

          {!feedback ? (
            <>
              {mode === "gloss" ? (
                <div>
                  <label className="label">提取拼写</label>
                  <input
                    className="field text-lg"
                    value={spelling}
                    onChange={(e) => {
                      spellingRef.current = e.target.value;
                      setSpelling(e.target.value);
                    }}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={phase === "tts"}
                    readOnly={recording}
                  />
                </div>
              ) : (
                <div>
                  <label className="label">提取中文</label>
                  <input
                    className="field text-lg"
                    value={meaningText}
                    onChange={(e) => {
                      meaningRef.current = e.target.value;
                      setMeaningText(e.target.value);
                    }}
                    autoComplete="off"
                    disabled={phase === "tts"}
                    readOnly={recording}
                  />
                </div>
              )}
              {error && (
                <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
                  {error}
                </p>
              )}
            </>
          ) : feedback.overallOk ? (
            <div className="rounded-md px-4 py-6 bg-[var(--ok-soft)] text-[var(--ok)] text-center space-y-2">
              <p className="font-display text-5xl leading-none" aria-label="正确">
                ✓
              </p>
              <p className="font-display text-xl">正确</p>
              <p className="text-sm opacity-80">
                {(feedback.mode || mode) === "meaning"
                  ? feedback.extractedMeaning || meaningText
                  : feedback.extractedSpelling || spelling}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md px-4 py-6 bg-[var(--danger-soft)] text-[var(--danger)] text-center space-y-2">
                <p className="font-display text-5xl leading-none" aria-label="错误">
                  ✗
                </p>
                <p className="font-display text-xl">错误</p>
                <p className="text-sm opacity-90">
                  你的：
                  {(feedback.mode || mode) === "meaning"
                    ? feedback.extractedMeaning || meaningText || feedback.asrTranscript || "—"
                    : feedback.extractedSpelling || spelling || "—"}
                </p>
                {(feedback.mode || mode) === "gloss" && (
                  <p className="text-xs opacity-80">
                    拼写 {feedback.spellingOk ? "✓" : "✗"} · 读音{" "}
                    {feedback.pronunciationOk ? "✓" : "✗"}
                  </p>
                )}
              </div>
              <p className="text-sm text-[var(--muted)] text-center">
                正解：<strong className="text-[var(--ink)]">{feedback.answer.word}</strong>
                {feedback.answer.glossZh ? ` · ${feedback.answer.glossZh}` : ""}
              </p>
              <button type="button" className="btn-primary w-full" onClick={retryCurrent}>
                重试本词
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
