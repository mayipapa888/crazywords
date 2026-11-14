"use client";

import { useCallback, useEffect, useState } from "react";
import { MicGate } from "@/components/MicGate";
import { MicRecorder } from "@/lib/mic";

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
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recorder] = useState(() => new MicRecorder());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttsNote, setTtsNote] = useState<string | null>(null);

  const current = items[index];

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
          ? `TTS mock（${data.provider}）：${data.spokenText}`
          : `TTS（${data.provider}）`,
      );
      if (data.audioBase64) {
        const src = `data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`;
        const audio = new Audio(src);
        void audio.play().catch(() => undefined);
      } else if (data.mock && typeof window !== "undefined" && window.speechSynthesis) {
        // 仅 mock：浏览器合成作开发提示；生产主 TTS 为阿里云
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
    setAudioBlob(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "无法开始会话");
        return;
      }
      setSessionId(data.sessionId);
      setItems(data.items || []);
      if (data.items?.[0]) speakPrompt(data.items[0]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    return () => recorder.cleanup();
  }, [recorder]);

  async function toggleRecord() {
    setError(null);
    if (!recording) {
      try {
        await recorder.start();
        setRecording(true);
        setAudioBlob(null);
      } catch {
        setError("无法开始录音。请检查麦克风权限。");
        setMicOk(false);
      }
      return;
    }
    try {
      const blob = await recorder.stop();
      setAudioBlob(blob);
      setRecording(false);
    } catch {
      setError("录音结束失败");
      setRecording(false);
    }
  }

  async function submit() {
    if (!sessionId || !current) return;
    if (!audioBlob) {
      setError("请先录音。听写必须提交语音，不能仅拼写。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("entryId", current.entryId);
      form.append("mode", current.mode);
      form.append("spellingInput", spelling);
      form.append("audio", audioBlob, "utterance.webm");
      const res = await fetch(`/api/sessions/${sessionId}/attempt`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "提交失败");
        return;
      }
      setFeedback(data);
    } finally {
      setBusy(false);
    }
  }

  function nextWord() {
    setFeedback(null);
    setSpelling("");
    setAudioBlob(null);
    const next = index + 1;
    if (next >= items.length) {
      if (sessionId) {
        fetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
      }
      setIndex(next);
      return;
    }
    setIndex(next);
    speakPrompt(items[next]);
  }

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
            麦克风已就绪。将按今日队列进行释义拼写 / 例句挖空（挖空可在设置关闭）。
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
        <p className="text-[var(--muted)]">共完成 {items.length} 词。错词已进入错词本，正确词已推进 SRS。</p>
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
            <span className="badge ml-1">
              {current.reason === "due" ? "到期" : current.reason === "wrong" ? "错词" : "新词"}
            </span>
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

        {!feedback ? (
          <>
            <div>
              <label className="label">拼写</label>
              <input
                className="field text-lg"
                value={spelling}
                onChange={(e) => setSpelling(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="输入英文单词"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={recording ? "btn-accent" : "btn-secondary"}
                onClick={toggleRecord}
              >
                {recording ? "停止录音" : audioBlob ? "重新录音" : "开始录音"}
              </button>
              {audioBlob && !recording && (
                <span className="badge-ok badge">已录制 {(audioBlob.size / 1024).toFixed(1)} KB</span>
              )}
            </div>

            {error && (
              <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
                {error}
              </p>
            )}

            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy || recording}
              onClick={submit}
            >
              {busy ? "判定中…" : "提交拼写 + 发音"}
            </button>
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
                {feedback.asrTranscript ? `（ASR: ${feedback.asrTranscript}）` : ""}
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
              {feedback.answer.glossZh && <p className="text-[var(--muted)]">{feedback.answer.glossZh}</p>}
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
