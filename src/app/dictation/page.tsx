"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicGate } from "@/components/MicGate";
import { extractLemmaFromTranscript } from "@/lib/speech/extract-lemma";
import { extractChineseFromTranscript, segmentChinese } from "@/lib/speech/extract-meaning";
import { playFailChime, playSuccessChime } from "@/lib/speech/play-sfx";
import { RealtimeAsrSession } from "@/lib/speech/realtime-client";

type DictationMode = "gloss" | "meaning";

type QueueSource = "today" | "random" | "wrong";

const RANGE_OPTIONS: { value: QueueSource; label: string }[] = [
  { value: "today", label: "今日队列（推荐）" },
  { value: "random", label: "随机 20 个" },
  { value: "wrong", label: "错词本" },
];

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
    pos: string | null;
    example: string | null;
    phrases?: string[];
    related?: string[];
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
    // 被 stopAnswerSpeech() 主动暂停时也要结束等待，避免 await 悬挂
    audio.onpause = done;
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

/** 答错后的正解卡片：词性、音标、例句、词组、相近词一次给全 */
function AnswerCard({ answer }: { answer: Feedback["answer"] }) {
  const rows: { label: string; value: string; wide?: boolean }[] = [
    { label: "单词", value: answer.word },
    { label: "音标", value: answer.ipa || "—" },
    { label: "词性", value: answer.pos || "—" },
    { label: "释义", value: answer.glossZh || "—", wide: true },
    { label: "例句", value: answer.example || "—", wide: true },
    { label: "词组", value: (answer.phrases || []).join(" / ") || "—", wide: true },
    { label: "相近", value: (answer.related || []).join(" / ") || "—", wide: true },
  ];
  return (
    <div className="no-scrollbar grid max-h-[34vh] grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto rounded-md border border-[var(--line)] bg-[var(--panel)] p-2 text-xs leading-snug">
      {rows.map((row) => (
        <p key={row.label} className={row.wide ? "col-span-2" : ""}>
          <span className="text-[var(--muted)]">{row.label}：</span>
          <span className="text-[var(--ink)]">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function DictationPage() {
  const [micOk, setMicOk] = useState(false);
  /** 用户点选的听写模式（页面按钮，不依赖设置开关） */
  const [selectedMode, setSelectedMode] = useState<DictationMode>("gloss");
  /** 听写范围：今日队列 / 随机 20 个 / 错词本 */
  const [source, setSource] = useState<QueueSource>("today");
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
  /** 开录后 N 秒内没有任何识别文本 → 自动停录并进入判定 */
  const noTextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 正解播报代际：点「重试本词 / 下一个」时自增，立即终止旧播报 */
  const answerGen = useRef(0);
  const answerAudioRef = useRef<HTMLAudioElement | null>(null);
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
    if (noTextTimer.current) clearTimeout(noTextTimer.current);
    autoStartTimer.current = null;
    autoSubmitTimer.current = null;
    autoNextTimer.current = null;
    tickTimer.current = null;
    noTextTimer.current = null;
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

  /** 立即终止正在进行的正解播报（音频 / 浏览器语音），并让旧循环自行退出 */
  const stopAnswerSpeech = useCallback(() => {
    answerGen.current += 1;
    const audio = answerAudioRef.current;
    answerAudioRef.current = null;
    if (audio) {
      try {
        audio.pause();
        audio.src = "";
      } catch {
        // 浏览器不允许操作时忽略
      }
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  /**
   * 答错后的正解播报：只读中文释义 ×3 → 英文例句 ×3，
   * 空内容跳过；每遍之间间隔 700ms，且逐遍 await 保证不重叠。
   * 单词 / 词组 / 相近词不再朗读。
   */
  const speakAnswer = useCallback(async (answer: Feedback["answer"]) => {
    const gen = answerGen.current + 1;
    answerGen.current = gen;
    const cancelled = () => answerGen.current !== gen;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const speakOnce = async (text: string, language: string) => {
      const value = (text || "").trim();
      if (!value || cancelled()) return;
      try {
        const res = await fetch("/api/speech/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value, language }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          audioBase64?: string;
          mimeType?: string;
        };
        if (cancelled()) return;
        if (res.ok && data.audioBase64) {
          await playAudioBase64(data.audioBase64, data.mimeType, answerAudioRef);
          return;
        }
        await playUtterance(value, language);
      } catch {
        if (!cancelled()) await playUtterance(value, language);
      }
    };

    const gloss = (answer.glossZh || "").trim();
    const example = (answer.example || "").trim();
    const passes: { text: string; language: string }[] = [];
    for (let i = 0; i < 3 && gloss; i += 1) {
      passes.push({ text: gloss, language: "zh-CN" });
    }
    for (let i = 0; i < 3 && example; i += 1) {
      passes.push({ text: example, language: "en-US" });
    }

    for (let i = 0; i < passes.length; i += 1) {
      if (cancelled()) return;
      await speakOnce(passes[i].text, passes[i].language);
      if (i < passes.length - 1) {
        if (cancelled()) return;
        await sleep(700);
      }
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
        fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source }),
        }),
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
      if (rawItems.length === 0) {
        setError(
          source === "wrong" ? "错词本没有可听写的词" : "当前范围没有可听写的词",
        );
        return;
      }
      setSessionId(data.sessionId);
      setItems(rawItems.map((it) => ({ ...it, mode: selectedMode })));
    } catch {
      setError("无法开始会话");
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
          void fetch(`/api/sessions/${sessionId}/end`, { method: "POST" }).catch(
            () => undefined,
          );
        }
      }
      return next;
    });
  }, [clearTimers, items.length, sessionId]);

  const submitAttempt = useCallback(
    async (transcriptOverride?: string, allowEmpty = false) => {
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

        if (!live.trim() && !spellingInput && !allowEmpty) {
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

        // 错误：惋惜音 + 红叉 + 正解播报（释义×3 · 例句×3），可重试本词或直接下一个
        playFailChime();
        setFeedback(data);
        setPhase("feedback");
        void speakAnswer(data.answer);
      } finally {
        setBusy(false);
        submitLock.current = false;
      }
    },
    [sessionId, current, feedback, clearTimers, stopAsr, nextWord, speakAnswer],
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
            if (noTextTimer.current) {
              clearTimeout(noTextTimer.current);
              noTextTimer.current = null;
            }
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
            if (noTextTimer.current) {
              clearTimeout(noTextTimer.current);
              noTextTimer.current = null;
            }
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

      // 3 秒内没有任何识别文本 → 自动停录并直接进入判定（不再等 autoSubmitSeconds）
      if (noTextTimer.current) clearTimeout(noTextTimer.current);
      noTextTimer.current = setTimeout(() => {
        noTextTimer.current = null;
        if (liveTextRef.current.trim()) return;
        void (async () => {
          clearTimers();
          await stopAsr();
          await submitAttempt("", true);
        })();
      }, 3000);

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
  }, [
    current,
    recording,
    feedback,
    timers.autoSubmitSeconds,
    submitAttempt,
    clearTimers,
    stopAsr,
  ]);

  startRealtimeRef.current = startRealtime;

  const beginTimersAfterTts = useCallback(
    (item: QueueItem, immediate = false) => {
      const m =
        item.mode === "meaning" || item.mode === "cloze" ? "meaning" : "gloss";
      // 模式 B 或重试场景：播报结束立刻开录
      if (m === "meaning" || immediate) {
        setPhase("wait-record");
        // 用 ref 派发，避免拿到上一轮渲染里被 feedback 守卫拦住的旧 startRealtime
        void startRealtimeRef.current();
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
        void startRealtimeRef.current();
      }, timers.autoStartRecordSeconds * 1000);
    },
    [timers.autoStartRecordSeconds],
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
      // 重试：播报结束立即开录，不再等 autoStartRecordSeconds
      beginTimersAfterTts(current, true);
    })();
  }, [current, clearTimers, speakEntry, beginTimersAfterTts]);

  useEffect(() => {
    return () => {
      clearTimers();
      void stopAsr();
      stopAnswerSpeech();
    };
  }, [clearTimers, stopAsr, stopAnswerSpeech]);

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
      <div className="flex h-full max-w-lg flex-col gap-2">
        <h1 className="font-display text-xl">听写</h1>
        <div className="panel space-y-3 p-4">
          <p className="text-sm text-[var(--muted)]">
            请选择本轮模式。答对叮咚后进入下一词；答错红叉可「重试本词」或「下一个」，并自动朗读正解（释义×3 · 例句×3）。
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={`rounded-lg border px-3 py-3 text-left transition ${
                selectedMode === "gloss"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] hover:border-[var(--accent)]"
              }`}
              onClick={() => setSelectedMode("gloss")}
            >
              <span className="font-display block text-base">模式 A</span>
              <span className="text-xs text-[var(--muted)]">中文 → 拼写朗读</span>
            </button>
            <button
              type="button"
              className={`rounded-lg border px-3 py-3 text-left transition ${
                selectedMode === "meaning"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] hover:border-[var(--accent)]"
              }`}
              onClick={() => setSelectedMode("meaning")}
            >
              <span className="font-display block text-base">模式 B</span>
              <span className="text-xs text-[var(--muted)]">单词 → 说中文</span>
            </button>
          </div>

          <div className="space-y-1">
            <p className="label mb-0">听写范围</p>
            <div className="grid grid-cols-3 gap-2">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-lg border px-2 py-1.5 text-center text-xs transition ${
                    source === option.value
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] hover:border-[var(--accent)]"
                  }`}
                  onClick={() => setSource(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
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

  const liveSegments = mode === "meaning" ? segmentChinese(liveText) : [];

  return (
    <div className="flex h-full max-w-2xl flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h1 className="font-display text-xl">听写</h1>
        <p className="text-[var(--muted)] text-xs">
          {index + 1} / {items.length}
          <span className="badge ml-2">
            {mode === "gloss" ? "模式 A · 中文→拼写" : "模式 B · 单词→中文"}
          </span>
        </p>
      </div>

      <div className="panel flex min-h-0 flex-1 flex-col gap-2 p-3">
        {mode === "gloss" ? (
          <div className="shrink-0">
            <p className="label mb-0">中文释义</p>
            <p className="font-display text-xl leading-snug">{current.glossZh}</p>
          </div>
        ) : (
          <div className="shrink-0">
            <p className="label mb-0">单词</p>
            <p className="font-display text-2xl tracking-wide">{current.word}</p>
            {current.ipa && (
              <p className="text-xs text-[var(--muted)]">{current.ipa}</p>
            )}
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {ttsNote && (
            <span className="rounded bg-[var(--chip)] px-2 py-1 text-xs text-[var(--muted)]">
              {ttsNote}
              {phase === "tts" ? " · 播报中" : ""}
            </span>
          )}
          {countdown && (
            <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent)]">
              {countdown}
            </span>
          )}
        </div>

        <section className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--chip)]/40 p-2.5">
          <p className="label mb-0">实时识别（累计）</p>
          <p className="font-display text-lg leading-snug whitespace-pre-wrap">
            {liveText ||
              (phase === "tts"
                ? "等待播报结束…"
                : recording
                  ? "正在听…"
                  : "等待开录…")}
          </p>
          {mode === "meaning" && liveSegments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-xs text-[var(--muted)]">分词：</span>
              {liveSegments.map((token, i) => (
                <span key={`${token}-${i}`} className="badge text-xs">
                  {token}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="shrink-0 space-y-2 rounded-lg border border-[var(--line)] p-2.5">
          <p className="label mb-0">判定区</p>

          {!feedback ? (
            <>
              {mode === "gloss" ? (
                <input
                  className="field text-base"
                  placeholder="提取拼写"
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
              ) : (
                <input
                  className="field text-base"
                  placeholder="提取中文"
                  value={meaningText}
                  onChange={(e) => {
                    meaningRef.current = e.target.value;
                    setMeaningText(e.target.value);
                  }}
                  autoComplete="off"
                  disabled={phase === "tts"}
                  readOnly={recording}
                />
              )}
              {error && (
                <p className="rounded-md bg-[var(--danger-soft)] px-2 py-1 text-xs text-[var(--danger)]">
                  {error}
                </p>
              )}
            </>
          ) : feedback.overallOk ? (
            <div className="rounded-md bg-[var(--ok-soft)] px-3 py-2 text-center text-[var(--ok)]">
              <span className="font-display text-lg">✓ 正确</span>
              <span className="ml-2 text-xs opacity-80">
                {(feedback.mode || mode) === "meaning"
                  ? feedback.extractedMeaning || meaningText
                  : feedback.extractedSpelling || spelling}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md bg-[var(--danger-soft)] px-3 py-1.5 text-center text-sm text-[var(--danger)]">
                <span className="font-display text-lg">✗ 错误</span>
                <span className="ml-2 opacity-90">
                  你的：
                  {(feedback.mode || mode) === "meaning"
                    ? feedback.extractedMeaning || meaningText || feedback.asrTranscript || "—"
                    : feedback.extractedSpelling || spelling || "—"}
                </span>
                {(feedback.mode || mode) === "gloss" && (
                  <span className="ml-2 text-xs opacity-80">
                    拼写 {feedback.spellingOk ? "✓" : "✗"} · 读音{" "}
                    {feedback.pronunciationOk ? "✓" : "✗"}
                  </span>
                )}
              </div>
              <AnswerCard answer={feedback.answer} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[var(--muted)]">
                  正解播报：释义×3 · 例句×3
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1 text-xs"
                    onClick={() => {
                      stopAnswerSpeech();
                      nextWord();
                    }}
                  >
                    下一个
                  </button>
                  <button
                    type="button"
                    className="btn-primary px-3 py-1 text-xs"
                    onClick={() => {
                      stopAnswerSpeech();
                      retryCurrent();
                    }}
                  >
                    重试本词
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
