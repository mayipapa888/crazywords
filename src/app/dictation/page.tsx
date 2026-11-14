"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicGate } from "@/components/MicGate";
import { extractLemmaFromTranscript } from "@/lib/speech/extract-lemma";
import { RealtimeAsrSession } from "@/lib/speech/realtime-client";

type QueueItem = {
  entryId: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  mode: "gloss" | "cloze";
  reason: string;
};

type Feedback = {
  spellingOk: boolean;
  pronunciationOk: boolean;
  overallOk: boolean;
  asrTranscript: string | null;
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

function clozeText(example: string, word: string) {
  const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
  return example.replace(re, "______");
}

export default function DictationPage() {
  const [micOk, setMicOk] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [spelling, setSpelling] = useState("");
  const [liveText, setLiveText] = useState("");
  const [recording, setRecording] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttsNote, setTtsNote] = useState<string | null>(null);
  const [timers, setTimers] = useState<Timers>({
    autoSubmitSeconds: 15,
    autoStartRecordSeconds: 10,
    autoNextWordSeconds: 30,
  });
  const [countdown, setCountdown] = useState<string | null>(null);

  const asrRef = useRef<RealtimeAsrSession | null>(null);
  const submitLock = useRef(false);
  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = items[index];

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

  const speakPrompt = useCallback(async (item: QueueItem) => {
    const text =
      item.mode === "gloss"
        ? `请根据释义拼写并朗读：${item.glossZh || ""}${item.pos ? `，${item.pos}` : ""}`
        : `请根据挖空例句拼写并朗读：${item.example ? clozeText(item.example, item.word) : ""}`;
    try {
      const res = await fetch("/api/speech/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setTtsNote(
        data.mock
          ? `TTS mock（${data.provider}）`
          : `TTS（${data.provider}）`,
      );
      if (data.audioBase64) {
        const src = `data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`;
        const audio = new Audio(src);
        void audio.play().catch(() => undefined);
      } else if (data.mock && typeof window !== "undefined" && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-CN";
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    } catch {
      setTtsNote("TTS 调用失败");
    }
  }, []);

  async function startSession() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    setIndex(0);
    setSpelling("");
    setLiveText("");
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
      if (data.items?.[0]) void speakPrompt(data.items[0]);
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
        await stopAsr();
        const transcript =
          transcriptOverride ??
          liveText ??
          asrRef.current?.transcript ??
          "";
        const lemma =
          spelling.trim() ||
          extractLemmaFromTranscript(transcript, current.word);
        if (!transcript.trim() && !lemma) {
          setError("未获得识别文本。请开口朗读，或检查麦克风 / 实时识别配置。");
          return;
        }
        const res = await fetch(`/api/sessions/${sessionId}/attempt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: current.entryId,
            mode: current.mode,
            spellingInput: lemma,
            realtimeTranscript: transcript || lemma,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "提交失败");
          return;
        }
        setFeedback(data);
        setSpelling(lemma);
      } finally {
        setBusy(false);
        submitLock.current = false;
      }
    },
    [sessionId, current, feedback, liveText, spelling, clearTimers, stopAsr],
  );

  const startRealtime = useCallback(async () => {
    if (!current || recording || feedback) return;
    setError(null);
    setLiveText("");
    try {
      const session = new RealtimeAsrSession(
        {
          onPartial: (t) => {
            setLiveText(t);
            const lemma = extractLemmaFromTranscript(t, current.word);
            if (lemma) setSpelling(lemma);
          },
          onFinal: (t) => {
            setLiveText(t);
            const lemma = extractLemmaFromTranscript(t, current.word);
            if (lemma) setSpelling(lemma);
          },
          onError: (e) => setError(e.message),
        },
        current.word,
      );
      asrRef.current = session;
      await session.start();
      setRecording(true);
      // 自动提交倒计时
      let left = timers.autoSubmitSeconds;
      setCountdown(`录音中，${left}s 后自动提交`);
      tickTimer.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (tickTimer.current) clearInterval(tickTimer.current);
          setCountdown(null);
        } else {
          setCountdown(`录音中，${left}s 后自动提交`);
        }
      }, 1000);
      autoSubmitTimer.current = setTimeout(() => {
        void submitAttempt();
      }, timers.autoSubmitSeconds * 1000);
    } catch (e) {
      setRecording(false);
      setMicOk(false);
      setError(e instanceof Error ? e.message : "无法开始实时识别");
    }
  }, [current, recording, feedback, timers.autoSubmitSeconds, submitAttempt]);

  // 进入新题：自动开始录音倒计时
  useEffect(() => {
    if (!sessionId || !current || feedback || index >= items.length) return;
    clearTimers();
    setLiveText("");
    setSpelling("");
    submitLock.current = false;

    let left = timers.autoStartRecordSeconds;
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

    return () => {
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
    setLiveText("");
    const next = index + 1;
    if (next >= items.length) {
      if (sessionId) {
        void fetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
      }
      setIndex(next);
      return;
    }
    setIndex(next);
    void speakPrompt(items[next]);
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
            麦克风已就绪。将使用<strong>实时语音识别</strong>边说边显示；可在设置中调整自动开录 / 提交 / 下一词秒数。
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
              {current.mode === "gloss" ? "释义拼写" : "例句挖空"}
            </span>
            <span className="badge ml-1">实时识别</span>
          </p>
        </div>
      </div>

      <div className="panel p-6 space-y-5">
        {current.mode === "gloss" ? (
          <div>
            <p className="label">中文释义</p>
            <p className="font-display text-2xl leading-snug">
              {current.glossZh}
              {current.pos ? (
                <span className="text-base text-[var(--muted)] ml-2">{current.pos}</span>
              ) : null}
            </p>
          </div>
        ) : (
          <div>
            <p className="label">挖空例句</p>
            <p className="font-display text-xl leading-relaxed">
              {current.example ? clozeText(current.example, current.word) : "（无例句）"}
            </p>
          </div>
        )}

        {ttsNote && (
          <p className="text-xs text-[var(--muted)] bg-[var(--chip)] rounded-md px-3 py-2">
            {ttsNote}
          </p>
        )}
        {countdown && (
          <p className="text-sm text-[var(--accent)] bg-[var(--accent-soft)] rounded-md px-3 py-2">
            {countdown}
          </p>
        )}

        {!feedback ? (
          <>
            <div>
              <label className="label">实时识别</label>
              <div className="field min-h-[3rem] bg-[var(--chip)] text-base">
                {liveText || (recording ? "正在听…" : "等待开录…")}
              </div>
            </div>
            <div>
              <label className="label">自动提取拼写（可改）</label>
              <input
                className="field text-lg"
                value={spelling}
                onChange={(e) => setSpelling(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {!recording ? (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => startRealtime()}>
                  立即开始录音
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-accent"
                  disabled={busy}
                  onClick={() => void submitAttempt()}
                >
                  停止并提交
                </button>
              )}
            </div>
            {error && (
              <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="space-y-4">
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
              <p className="text-sm mt-1">
                拼写 {feedback.spellingOk ? "✓" : "✗"} · 发音 {feedback.pronunciationOk ? "✓" : "✗"}
                {feedback.asrTranscript ? `（识别: ${feedback.asrTranscript}）` : ""}
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
      </div>
    </div>
  );
}
