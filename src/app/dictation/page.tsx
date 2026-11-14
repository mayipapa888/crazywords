"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicGate } from "@/components/MicGate";
import { extractLemmaFromTranscript } from "@/lib/speech/extract-lemma";
import {
  extractChineseFromTranscript,
} from "@/lib/speech/extract-meaning";
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

function normalizeMode(mode: QueueItem["mode"]): DictationMode {
  return mode === "meaning" || mode === "cloze" ? "meaning" : "gloss";
}

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

export default function DictationPage() {
  const [micOk, setMicOk] = useState(false);
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
  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = items[index];
  const mode = current ? normalizeMode(current.mode) : "gloss";

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

  const speakPrompt = useCallback(async (item: QueueItem): Promise<void> => {
    const m = normalizeMode(item.mode);
    const text =
      m === "gloss"
        ? `请根据中文释义拼写并朗读单词。${item.glossZh || ""}${item.pos ? `，${item.pos}` : ""}`
        : `请说出这个单词的中文意思。${item.word}`;
    const lang = m === "gloss" ? "zh-CN" : "en-US";
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
        // aliyun 生产路径禁止回退浏览器 SpeechSynthesis
        return;
      }
      setTtsNote(
        data.mock
          ? `TTS mock（${data.provider}）· 仅开发；生产请 SPEECH_PROVIDER=aliyun`
          : `阿里云 TTS（${data.provider}）`,
      );
      if (data.audioBase64) {
        await playAudioBase64(data.audioBase64, data.mimeType);
        return;
      }
      // 仅 mock 允许用浏览器合成顶替无音频响应
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
      setSessionId(data.sessionId);
      setItems(data.items || []);
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
          liveText ??
          asrRef.current?.transcript ??
          "";
        await stopAsr();
        const m = normalizeMode(current.mode);
        const spellingInput =
          m === "gloss"
            ? spelling.trim() ||
              extractLemmaFromTranscript(live, current.word)
            : meaningText.trim() || extractChineseFromTranscript(live);

        if (!live.trim() && !spellingInput) {
          setError("未获得识别文本。请开口作答，或检查麦克风 / 实时识别配置。");
          setPhase("wait-record");
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
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "提交失败");
          setPhase("wait-record");
          return;
        }
        setFeedback(data);
        setPhase("feedback");
        if (m === "gloss") setSpelling(spellingInput);
        else setMeaningText(spellingInput);
      } finally {
        setBusy(false);
        submitLock.current = false;
      }
    },
    [
      sessionId,
      current,
      feedback,
      liveText,
      spelling,
      meaningText,
      clearTimers,
      stopAsr,
    ],
  );

  const startRealtime = useCallback(async () => {
    if (!current || recording || feedback) return;
    setError(null);
    setLiveText("");
    const m = normalizeMode(current.mode);
    try {
      const session = new RealtimeAsrSession(
        {
          onPartial: (t) => {
            setLiveText(t);
            if (m === "gloss") {
              const lemma = extractLemmaFromTranscript(t, current.word);
              if (lemma) setSpelling(lemma);
            } else {
              const zh = extractChineseFromTranscript(t);
              if (zh) setMeaningText(zh);
            }
          },
          onFinal: (t) => {
            setLiveText(t);
            if (m === "gloss") {
              const lemma = extractLemmaFromTranscript(t, current.word);
              if (lemma) setSpelling(lemma);
            } else {
              const zh = extractChineseFromTranscript(t);
              if (zh) setMeaningText(zh);
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
      setCountdown(`录音中，${left}s 后自动提交（可点「说完了」提前结束）`);
      tickTimer.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (tickTimer.current) clearInterval(tickTimer.current);
          setCountdown(null);
        } else {
          setCountdown(`录音中，${left}s 后自动提交（可点「说完了」提前结束）`);
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

  const beginTimersAfterTts = useCallback(
    (item: QueueItem) => {
      const m = normalizeMode(item.mode);
      // 模式 B：播报后直接开录；模式 A：先倒计时再开录
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
    setSpelling("");
    setMeaningText("");
    setError(null);
    submitLock.current = false;
    setPhase("tts");
    setCountdown("正在播报提示…");

    void (async () => {
      await speakPrompt(current);
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

  // 反馈后自动下一词
  useEffect(() => {
    if (!feedback) return;
    let left = timers.autoNextWordSeconds;
    setCountdown(`${left}s 后自动下一词`);
    tickTimer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        if (tickTimer.current) clearInterval(tickTimer.current);
        setCountdown(null);
      } else {
        setCountdown(`${left}s 后自动下一词`);
      }
    }, 1000);
    autoNextTimer.current = setTimeout(() => {
      nextWord();
    }, timers.autoNextWordSeconds * 1000);
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  function nextWord() {
    clearTimers();
    setFeedback(null);
    setSpelling("");
    setMeaningText("");
    setLiveText("");
    setPhase("idle");
    const next = index + 1;
    if (next >= items.length) {
      if (sessionId) {
        void fetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
      }
      setIndex(next);
      return;
    }
    setIndex(next);
  }

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
        <div className="panel p-6 space-y-4">
          <p className="text-[var(--muted)]">
            双模式：<strong>报中文 → 拼写朗读</strong>，以及可开关的
            <strong> 报单词 → 说中文意思</strong>。实时识别文本显示在上方；判定结果在下方。
          </p>
          <p className="text-sm text-[var(--muted)]">
            模式 A 在 TTS 播报结束后才开始计时。可在设置中调整自动开录 / 提交 / 下一词秒数。
          </p>
          {error && (
            <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
              {error}
            </p>
          )}
          <button type="button" className="btn-primary" disabled={busy} onClick={startSession}>
            {busy ? "准备中…" : "开始今日听写"}
          </button>
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
          返回
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
              {mode === "gloss" ? "模式 A · 释义→拼写" : "模式 B · 单词→中文"}
            </span>
            <span className="badge ml-1">实时识别</span>
          </p>
        </div>
      </div>

      <div className="panel p-6 space-y-5">
        {/* 题目提示 */}
        {mode === "gloss" ? (
          <div>
            <p className="label">中文释义（请拼写并朗读对应单词）</p>
            <p className="font-display text-2xl leading-snug">
              {current.glossZh}
              {current.pos ? (
                <span className="text-base text-[var(--muted)] ml-2">{current.pos}</span>
              ) : null}
            </p>
          </div>
        ) : (
          <div>
            <p className="label">英文单词（请说出中文意思）</p>
            <p className="font-display text-3xl tracking-wide">{current.word}</p>
            {current.ipa && (
              <p className="text-[var(--muted)] mt-1">{current.ipa}</p>
            )}
          </div>
        )}

        {ttsNote && (
          <p className="text-xs text-[var(--muted)] bg-[var(--chip)] rounded-md px-3 py-2">
            {ttsNote}
            {phase === "tts" ? " · 播报中，结束后开始计时" : ""}
          </p>
        )}
        {countdown && (
          <p className="text-sm text-[var(--accent)] bg-[var(--accent-soft)] rounded-md px-3 py-2">
            {countdown}
          </p>
        )}

        {/* 上半：实时识别 */}
        <section className="rounded-lg border border-[var(--line)] bg-[var(--chip)]/40 p-4 space-y-2">
          <p className="label mb-0">实时识别（上）</p>
          <p className="min-h-[4.5rem] font-display text-xl leading-relaxed whitespace-pre-wrap">
            {liveText ||
              (phase === "tts"
                ? "等待播报结束…"
                : recording
                  ? "正在听…"
                  : "等待开录…")}
          </p>
        </section>

        {/* 下半：提取预览或判定 */}
        <section className="rounded-lg border border-[var(--line)] p-4 space-y-3">
          <p className="label mb-0">判定区（下）</p>

          {!feedback ? (
            <>
              {mode === "gloss" ? (
                <div>
                  <label className="label">提取拼写（可改）</label>
                  <input
                    className="field text-lg"
                    value={spelling}
                    onChange={(e) => setSpelling(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={phase === "tts"}
                  />
                  <p className="text-xs text-[var(--muted)] mt-1">
                    提交后将分别判定：拼写对错 · 读音对错
                  </p>
                </div>
              ) : (
                <div>
                  <label className="label">提取中文释义（可改）</label>
                  <input
                    className="field text-lg"
                    value={meaningText}
                    onChange={(e) => setMeaningText(e.target.value)}
                    autoComplete="off"
                    disabled={phase === "tts"}
                  />
                  <p className="text-xs text-[var(--muted)] mt-1">
                    将与词条中文释义比对
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {phase === "wait-record" && !recording && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      clearTimers();
                      void startRealtime();
                    }}
                  >
                    立即开始录音
                  </button>
                )}
                {recording && (
                  <button
                    type="button"
                    className="btn-accent"
                    disabled={busy}
                    onClick={() => {
                      clearTimers();
                      void submitAttempt();
                    }}
                  >
                    说完了
                  </button>
                )}
              </div>
              {error && (
                <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
                  {error}
                </p>
              )}
            </>
          ) : (feedback.mode || mode) === "meaning" ? (
            <div className="space-y-4">
              <div
                className={`rounded-md px-4 py-3 ${
                  feedback.meaningOk
                    ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                    : "bg-[var(--danger-soft)] text-[var(--danger)]"
                }`}
              >
                <p className="text-xs opacity-80">中文释义</p>
                <p className="font-display text-xl">
                  {feedback.meaningOk ? "正确" : "错误"}
                </p>
                <p className="text-sm mt-1">
                  你说：{feedback.extractedMeaning || meaningText || feedback.asrTranscript || "—"}
                </p>
              </div>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-[var(--muted)]">单词：</span>
                  <strong className="text-lg ml-1">{feedback.answer.word}</strong>
                </p>
                {feedback.answer.glossZh && (
                  <p>
                    <span className="text-[var(--muted)]">正解释义：</span>
                    {feedback.answer.glossZh}
                  </p>
                )}
              </div>
              <button type="button" className="btn-primary w-full" onClick={nextWord}>
                {index + 1 >= items.length ? "完成本轮" : "下一词"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`rounded-md px-3 py-3 ${
                    feedback.spellingOk
                      ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                      : "bg-[var(--danger-soft)] text-[var(--danger)]"
                  }`}
                >
                  <p className="text-xs opacity-80">拼写</p>
                  <p className="font-display text-lg">
                    {feedback.spellingOk ? "正确" : "错误"}
                  </p>
                  <p className="text-sm mt-1 opacity-90">
                    你的：{feedback.extractedSpelling || spelling || "—"}
                  </p>
                </div>
                <div
                  className={`rounded-md px-3 py-3 ${
                    feedback.pronunciationOk
                      ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                      : "bg-[var(--danger-soft)] text-[var(--danger)]"
                  }`}
                >
                  <p className="text-xs opacity-80">读音</p>
                  <p className="font-display text-lg">
                    {feedback.pronunciationOk ? "正确" : "错误"}
                  </p>
                  <p className="text-sm mt-1 opacity-90 truncate" title={feedback.asrTranscript || ""}>
                    识别：{feedback.asrTranscript || "—"}
                  </p>
                </div>
              </div>
              <div
                className={`rounded-md px-4 py-3 ${
                  feedback.overallOk
                    ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                    : "bg-[var(--danger-soft)] text-[var(--danger)]"
                }`}
              >
                <p className="font-display text-xl">
                  {feedback.overallOk ? "全对" : "未通过"}
                </p>
              </div>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-[var(--muted)]">正解：</span>
                  <strong className="text-lg ml-1">{feedback.answer.word}</strong>
                  {feedback.answer.ipa && (
                    <span className="text-[var(--muted)] ml-2">{feedback.answer.ipa}</span>
                  )}
                </p>
                {feedback.answer.glossZh && (
                  <p className="text-[var(--muted)]">{feedback.answer.glossZh}</p>
                )}
              </div>
              <button type="button" className="btn-primary w-full" onClick={nextWord}>
                {index + 1 >= items.length ? "完成本轮" : "下一词"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
