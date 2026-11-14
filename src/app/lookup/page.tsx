"use client";

import { useEffect, useState } from "react";
import { MicGate } from "@/components/MicGate";
import { MicRecorder } from "@/lib/mic";

type Entry = {
  id: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string[];
  related: string[];
};

export default function LookupPage() {
  const [micOk, setMicOk] = useState(false);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [recorder] = useState(() => new MicRecorder());
  const [result, setResult] = useState<{
    query: string;
    found: boolean;
    message?: string;
    entry?: Entry;
    fromAsr?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => recorder.cleanup(), [recorder]);

  async function lookupText() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "查词失败");
        return;
      }
      setResult(data);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoice() {
    setError(null);
    if (!recording) {
      try {
        await recorder.start();
        setRecording(true);
      } catch {
        setError("无法录音，请授权麦克风");
        setMicOk(false);
      }
      return;
    }
    setBusy(true);
    try {
      const blob = await recorder.stop();
      setRecording(false);
      const form = new FormData();
      form.append("audio", blob, "query.webm");
      if (text.trim()) form.append("text", text.trim()); // mock ASR hint 可选
      const res = await fetch("/api/lookup", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "语音查词失败");
        return;
      }
      setResult(data);
      if (data.query) setText(data.query);
    } catch {
      setError("语音查词失败");
      setRecording(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="font-display text-3xl">语音查词</h1>
        <p className="text-[var(--muted)] mt-1">
          录音经服务端 ASR stub 转写后查库；亦可直接输入单词。
        </p>
      </div>

      {!micOk ? (
        <MicGate title="查词需要麦克风" onGranted={() => setMicOk(true)} />
      ) : (
        <div className="panel p-6 space-y-4">
          <div>
            <label className="label">单词</label>
            <input
              className="field"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入或语音识别"
              onKeyDown={(e) => e.key === "Enter" && lookupText()}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={lookupText}>
              文字查词
            </button>
            <button
              type="button"
              className={recording ? "btn-accent" : "btn-secondary"}
              disabled={busy}
              onClick={toggleVoice}
            >
              {recording ? "停止并识别" : "语音查词"}
            </button>
          </div>
          {error && (
            <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
              {error}
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="panel p-6 space-y-3">
          <p className="text-sm text-[var(--muted)]">
            查询「{result.query}」
            {result.fromAsr ? " · 来自 ASR" : ""}
          </p>
          {!result.found || !result.entry ? (
            <p className="font-display text-xl">{result.message || "词库中无此词"}</p>
          ) : (
            <>
              <p className="font-display text-3xl">
                {result.entry.word}
                {result.entry.pos && (
                  <span className="text-base text-[var(--muted)] ml-2">{result.entry.pos}</span>
                )}
              </p>
              {result.entry.ipa && <p className="text-[var(--muted)]">{result.entry.ipa}</p>}
              <p className="text-lg">{result.entry.glossZh}</p>
              {result.entry.example && (
                <p className="text-sm text-[var(--muted)] border-l-2 border-[var(--teal)] pl-3">
                  {result.entry.example}
                </p>
              )}
              {result.entry.phrases?.length > 0 && (
                <p className="text-sm">
                  <span className="text-[var(--muted)]">词组：</span>
                  {result.entry.phrases.join(" · ")}
                </p>
              )}
              {result.entry.related?.length > 0 && (
                <p className="text-sm">
                  <span className="text-[var(--muted)]">相关：</span>
                  {result.entry.related.join(" · ")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
