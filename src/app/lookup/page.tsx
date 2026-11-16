"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractLemmaFromTranscript } from "@/lib/speech/extract-lemma";
import { RealtimeAsrSession } from "@/lib/speech/realtime-client";

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

/**
 * 把 getUserMedia / 实时识别抛出的错误翻成页面内一行中文提示。
 * 只有点「开始语音识别」时才会走到这里；失败不影响手动输入查词。
 */
function micErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "麦克风权限被拒绝：请在浏览器地址栏允许麦克风后重试。仍可手动输入查词。";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "未检测到麦克风设备。仍可手动输入查词。";
      case "NotReadableError":
      case "TrackStartError":
        return "麦克风被其他程序占用或无法读取。仍可手动输入查词。";
      case "SecurityError":
        return "当前页面无法访问麦克风（需 HTTPS 或 localhost）。仍可手动输入查词。";
      case "AbortError":
        return "麦克风启动被中断，请重试或手动输入查词。";
      default:
        break;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "无法开始实时识别，仍可手动输入查词。";
}

export default function LookupPage() {
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
    // 查询前先停掉仍在进行的实时识别：先清引用再 await，避免查询期间继续写入输入框
    const asr = asrRef.current;
    asrRef.current = null;
    if (asr) {
      try {
        await asr.stop();
      } catch {
        // 停止识别失败不应打断查询
      }
    }
    setRecording(false);
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
    // 仅在此按钮回调里触碰麦克风：进入页面、打字、查词都不会申请权限
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("当前环境不支持麦克风（需 HTTPS 或 localhost）。仍可手动输入查词。");
      return;
    }
    let session: RealtimeAsrSession | null = null;
    try {
      session = new RealtimeAsrSession(
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
      if (asrRef.current !== session) {
        // 启动期间用户已发起查询（或已离开），立即收尾，避免麦克风继续采集
        await session.stop().catch(() => undefined);
        return;
      }
      setRecording(true);
    } catch (e) {
      if (session && asrRef.current === session) asrRef.current = null;
      setError(micErrorMessage(e));
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
      // 加入成功后该词已在词表中，隐藏「加入词表」按钮，避免重复加入
      setResult((prev) => (prev ? { ...prev, inWordList: true } : prev));
    } catch {
      setError("加入词表失败");
    } finally {
      setBusy(false);
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
  const senses = (entry?.senses ?? []).slice(0, 4);
  // 本地词条没有 synonyms 字段，用 related 兜底；外网 related 是 synonyms 子集，避免重复展示
  const showRelated = synonyms.length === 0 && related.length > 0;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0">
        <h1 className="font-display text-xl">语音查词</h1>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          实时识别写入下方输入框，可改后再查询。支持中文或英文；先查本地词表，没有再外网补全。
        </p>
      </div>

      {/* 不在这里申请麦克风：输入框和查词按钮先可用，点「开始语音识别」才 getUserMedia */}
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
              <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                {result.entry.glossZh}
              </p>
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
              {result.inWordList ? (
                <p className="text-xs text-[var(--muted)] bg-[var(--ok-soft)] px-2 py-1 rounded-md mt-1">
                  该词已在你的词表中，无需重复加入
                </p>
              ) : (
                <button
                  type="button"
                  className="btn-primary w-full text-sm mt-1"
                  disabled={busy}
                  onClick={() => void addToList()}
                >
                  加入词表
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
