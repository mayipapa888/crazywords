"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicGate } from "@/components/MicGate";
import { extractLemmaFromTranscript } from "@/lib/speech/extract-lemma";
import { RealtimeAsrSession } from "@/lib/speech/realtime-client";

type EntryView = {
  id: string | null;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string[];
  related: string[];
};

type LookupResult = {
  query: string;
  found: boolean;
  source?: string;
  message?: string;
  warnings?: string[];
  entry?: EntryView | null;
  fromAsr?: boolean;
};

export default function LookupPage() {
  const [micOk, setMicOk] = useState(false);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const asrRef = useRef<RealtimeAsrSession | null>(null);
  const textRef = useRef("");

  useEffect(() => {
    return () => {
      void asrRef.current?.stop().catch(() => undefined);
    };
  }, []);

  const runLookup = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setError("请输入或语音识别后再查询");
      return;
    }
    setBusy(true);
    setError(null);
    setAddMsg(null);
    try {
      const res = await fetch("/api/lookup", {
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
        textRef.current = data.query;
      }
    } catch {
      setError("查词失败");
    } finally {
      setBusy(false);
    }
  }, []);

  async function startVoice() {
    setError(null);
    setAddMsg(null);
    try {
      const session = new RealtimeAsrSession(
        {
          onPartial: (t) => {
            // 实时写入可编辑框（优先提取英文 lemma，否则保留全文）
            const lemma = extractLemmaFromTranscript(t);
            const next = lemma || t;
            textRef.current = next;
            setText(next);
          },
          onFinal: (t) => {
            const lemma = extractLemmaFromTranscript(t);
            const next = lemma || t;
            textRef.current = next;
            setText(next);
          },
          onError: (e) => setError(e.message),
        },
        { language: "en", targetText: textRef.current || undefined },
      );
      asrRef.current = session;
      await session.start();
      setRecording(true);
    } catch (e) {
      setMicOk(false);
      setError(e instanceof Error ? e.message : "无法开始实时识别");
    }
  }

  async function stopVoice() {
    const s = asrRef.current;
    asrRef.current = null;
    if (s) await s.stop().catch(() => undefined);
    setRecording(false);
  }

  async function addToList() {
    if (!result?.entry?.word) return;
    setBusy(true);
    setAddMsg(null);
    setError(null);
    try {
      const e = result.entry;
      const res = await fetch("/api/entries/manual", {
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
    } catch {
      setError("加入词表失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0">
        <h1 className="font-display text-xl">语音查词</h1>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          实时识别写入下方输入框，可改后再查询。支持中文或英文；先查本地词表，没有再外网补全。
        </p>
      </div>

      {!micOk ? (
        <MicGate title="查词需要麦克风" onGranted={() => setMicOk(true)} />
      ) : (
        <div className="panel p-3 space-y-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <label className="label shrink-0 mb-0">查询（可编辑）</label>
            <input
              className="field flex-1 min-w-[10rem] text-sm"
              value={text}
              onChange={(e) => {
                textRef.current = e.target.value;
                setText(e.target.value);
              }}
              placeholder="说英语单词或中文释义，或直接输入"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runLookup(text);
              }}
            />
            {!recording ? (
              <button
                type="button"
                className="btn-secondary text-sm shrink-0"
                disabled={busy}
                onClick={() => void startVoice()}
              >
                开始语音识别
              </button>
            ) : (
              <button
                type="button"
                className="btn-accent text-sm shrink-0"
                disabled={busy}
                onClick={() => void stopVoice()}
              >
                停止识别
              </button>
            )}
            <button
              type="button"
              className="btn-primary text-sm shrink-0"
              disabled={busy || !text.trim()}
              onClick={() => void runLookup(text)}
            >
              {busy ? "查询中…" : "确定查询"}
            </button>
          </div>
          {recording && (
            <p className="text-xs text-[var(--accent)]">实时识别中…可随时改字后点「确定查询」</p>
          )}
          {error && (
            <p className="text-xs text-[var(--danger)] bg-[var(--danger-soft)] px-2 py-1 rounded-md">
              {error}
            </p>
          )}
          {addMsg && (
            <p className="text-xs text-[var(--ok)] bg-[var(--ok-soft)] px-2 py-1 rounded-md">{addMsg}</p>
          )}
        </div>
      )}

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
              <p className="font-display text-xl">
                {result.entry.word}
                {result.entry.pos && (
                  <span className="text-xs text-[var(--muted)] ml-2">{result.entry.pos}</span>
                )}
              </p>
              {result.entry.ipa && <p className="text-xs text-[var(--muted)]">{result.entry.ipa}</p>}
              <p className="text-sm">{result.entry.glossZh}</p>
              {result.entry.example && (
                <p className="text-xs text-[var(--muted)] border-l-2 border-[var(--teal)] pl-2">
                  {result.entry.example}
                </p>
              )}
              {result.entry.phrases?.length > 0 && (
                <p className="text-xs">
                  <span className="text-[var(--muted)]">词组：</span>
                  {result.entry.phrases.join(" · ")}
                </p>
              )}
              {result.entry.related?.length > 0 && (
                <p className="text-xs">
                  <span className="text-[var(--muted)]">相关：</span>
                  {result.entry.related.join(" · ")}
                </p>
              )}
              <button
                type="button"
                className="btn-primary w-full text-sm mt-1"
                disabled={busy}
                onClick={() => void addToList()}
              >
                加入词表
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
