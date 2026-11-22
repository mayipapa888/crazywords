"use client";

import { withBase } from "@/lib/base-path";
import { useCallback, useEffect, useRef, useState } from "react";
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

/** 出现识别文本后，连续静音多久自动结束录音并判定（ms） */
const SILENCE_AFTER_SPEECH_MS = 3000;

/** 答错正解播报：释义、单词各读几遍 */
const ANSWER_REPEAT = 2;
/** 正解播报每遍之间的间隔（ms） */
const ANSWER_PASS_GAP_MS = 700;

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

/**
 * 键盘快捷键的焦点守卫：输入框 / 文本域 / 下拉框 / 可编辑区域及其内部元素
 * 有自己的回车、空格语义，交还给它们处理，避免重复触发。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'),
  );
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
  /** 会话进行中切换模式/范围时的提示：只改 state，点「重新开始」才生效 */
  const [settingsHint, setSettingsHint] = useState<string | null>(null);
  /** 当前会话实际使用的范围（切换范围后只有重开才更新） */
  const [sessionSource, setSessionSource] = useState<QueueSource>("today");
  /** 手动输入态：聚焦作答输入框后停录，不自动开录、不自动判定 */
  const [manualTyping, setManualTyping] = useState(false);
  /** 作答区「看提示」是否展开（展示正解，不影响继续作答） */
  const [hintOpen, setHintOpen] = useState(false);

  const asrRef = useRef<RealtimeAsrSession | null>(null);
  /** 进入页面自动申请麦克风，只申请一次（React 严格模式双执行也不会重复弹窗） */
  const micRequestedRef = useRef(false);
  const submitLock = useRef(false);
  const wordGen = useRef(0);
  const liveTextRef = useRef("");
  const spellingRef = useRef("");
  const meaningRef = useRef("");
  /** 本题是否已手写输入：手写优先，ASR 结果不再覆盖输入框 */
  const manualInputRef = useRef(false);
  /** manualTyping 的同步镜像：计时器 / 异步回调里读取，避免闭包读到旧值 */
  const manualTypingRef = useRef(false);
  const startRealtimeRef = useRef<() => Promise<void>>(async () => undefined);
  const submitAttemptRef = useRef<(transcriptOverride?: string) => Promise<void>>(
    async () => undefined,
  );
  /** window 键盘监听里调用最新的「开始听写 / 结束并判定」，避免闭包绑定旧函数 */
  const startSessionRef = useRef<() => void>(() => undefined);
  const endRecordingRef = useRef<() => void>(() => undefined);
  const nextWordRef = useRef<() => void>(() => undefined);
  const retryWordRef = useRef<() => void>(() => undefined);
  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 出现识别文本后才启动的静音计时器；每来一段新文本就重置 */
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 本轮开录后是否已经识别到过非空文本（没出声时绝不自动判错） */
  const speechSeenRef = useRef(false);
  /** 防止「自动开录」与「手动开始录音」并发启动两个 ASR 会话 */
  const startingAsrRef = useRef(false);
  /** ASR 会话代际：停止/切题/新开录时自增，旧回调与旧静音计时器据此失效 */
  const asrGen = useRef(0);
  /** 题目 TTS 音频：手动提前开录时要能立即停掉，避免录入播报声 */
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
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

  /** 键盘监听读取的最新状态快照：每次渲染同步，回调里不会拿到旧值 */
  const latestRef = useRef({ sessionId, recording, feedback, busy, index, total: items.length });
  latestRef.current = { sessionId, recording, feedback, busy, index, total: items.length };

  const clearTimers = useCallback(() => {
    if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    autoStartTimer.current = null;
    autoSubmitTimer.current = null;
    autoNextTimer.current = null;
    tickTimer.current = null;
    silenceTimer.current = null;
    setCountdown(null);
  }, []);

  const speakEntry = useCallback(async (item: QueueItem, gen: number): Promise<void> => {
    const { text, lang } = dictationTtsText(item);
    if (!text) {
      if (wordGen.current !== gen) return;
      setTtsNote("无可播报文本");
      return;
    }
    try {
      const res = await fetch(withBase("/api/speech/tts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang }),
      });
      const data = await res.json();
      // 等待 TTS 期间用户已手动开录或切题：绝不再补播，避免录入播报声
      if (wordGen.current !== gen) return;
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
        await playAudioBase64(data.audioBase64, data.mimeType, ttsAudioRef);
        return;
      }
      if (data.mock) {
        await playUtterance(text, lang);
        return;
      }
      setError("TTS 未返回音频。aliyun 模式必须使用阿里云语音合成。");
      setTtsNote("TTS 未返回音频");
    } catch (e) {
      if (wordGen.current !== gen) return;
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

  /** 立即终止正在进行的题目 TTS（音频 / 浏览器语音），手动提前开录时用 */
  const stopTtsSpeech = useCallback(() => {
    const audio = ttsAudioRef.current;
    ttsAudioRef.current = null;
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

  /** 正解播报单遍朗读：优先用后端返回的音频，否则退浏览器语音 */
  const playAnswerOnce = useCallback(
    async (text: string, language: string, cancelled: () => boolean): Promise<void> => {
      const value = (text || "").trim();
      if (!value || cancelled()) return;
      try {
        const res = await fetch(withBase("/api/speech/tts"), {
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
    },
    [],
  );

  /**
   * 答错后的正解播报：中文释义 ×2 → 英文单词 ×2（空内容跳过该部分）。
   * 不读例句 / 词组 / 相近词；每遍之间间隔 700ms，逐遍 await 保证不重叠。
   */
  const speakAnswer = useCallback(
    async (answer: Feedback["answer"]) => {
      const gen = answerGen.current + 1;
      answerGen.current = gen;
      const cancelled = () => answerGen.current !== gen;
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      const gloss = (answer.glossZh || "").trim();
      const word = (answer.word || "").trim();
      const passes: { text: string; language: string }[] = [];
      for (let i = 0; i < ANSWER_REPEAT && gloss; i += 1) {
        passes.push({ text: gloss, language: "zh-CN" });
      }
      for (let i = 0; i < ANSWER_REPEAT && word; i += 1) {
        passes.push({ text: word, language: "en-US" });
      }

      for (let i = 0; i < passes.length; i += 1) {
        if (cancelled()) return;
        await playAnswerOnce(passes[i].text, passes[i].language, cancelled);
        if (i < passes.length - 1) {
          if (cancelled()) return;
          await sleep(ANSWER_PASS_GAP_MS);
        }
      }
    },
    [playAnswerOnce],
  );

  /** 点「🔊」：先中断当前正解播报，再只把英文单词读一遍 */
  const replayAnswerWord = useCallback(
    async (word: string) => {
      const value = (word || "").trim();
      if (!value) return;
      stopAnswerSpeech();
      // stopAnswerSpeech 已自增代际；用新代际判断这次单遍朗读是否又被切题打断
      const gen = answerGen.current;
      const cancelled = () => answerGen.current !== gen;
      await playAnswerOnce(value, "en-US", cancelled);
    },
    [playAnswerOnce, stopAnswerSpeech],
  );

  /**
   * 「看提示」：展开时复用答错播报逻辑自动朗读正解（释义×2 → 单词×2），
   * 收起时立即停止朗读；切换提示前先掐断上一次播报，避免两段朗读叠加。
   */
  const toggleHint = useCallback(() => {
    if (!current) return;
    if (hintOpen) {
      stopAnswerSpeech();
      setHintOpen(false);
      return;
    }
    stopAnswerSpeech();
    setHintOpen(true);
    void speakAnswer({
      word: current.word,
      glossZh: current.glossZh,
      ipa: current.ipa,
      pos: current.pos,
      example: current.example,
    });
  }, [current, hintOpen, speakAnswer, stopAnswerSpeech]);

  /** 主动申请麦克风权限：点击模式按钮或开始听写时调用，拿到后立即释放，录音时再开 */
  const requestMic = useCallback(async (): Promise<boolean> => {
    if (micOk) return true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("当前环境无法访问麦克风（需 HTTPS 或 localhost），请改用 localhost 访问。");
        return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicOk(true);
      setError(null);
      return true;
    } catch {
      setError("麦克风权限未授予：请在浏览器地址栏允许麦克风后重试。");
      return false;
    }
  }, [micOk]);

  // 点击导航「听写」进入本页即申请麦克风；权限被拒只在页面内提示，不拦截进入
  useEffect(() => {
    if (micRequestedRef.current) return;
    micRequestedRef.current = true;
    void requestMic();
  }, [requestMic]);

  async function startSession() {
    void requestMic();
    setBusy(true);
    setError(null);
    setSettingsHint(null);
    setFeedback(null);
    setIndex(0);
    setSpelling("");
    setMeaningText("");
    setLiveText("");
    liveTextRef.current = "";
    spellingRef.current = "";
    meaningRef.current = "";
    manualInputRef.current = false;
    manualTypingRef.current = false;
    setManualTyping(false);
    setHintOpen(false);
    setPhase("idle");
    try {
      const [meRes, sessRes] = await Promise.all([
        fetch(withBase("/api/me")),
        fetch(withBase("/api/sessions"), {
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
      setSessionSource(source);
      setItems(rawItems.map((it) => ({ ...it, mode: selectedMode })));
    } catch {
      setError("无法开始会话");
    } finally {
      setBusy(false);
    }
  }

  const stopAsr = useCallback(async () => {
    // 代际自增：本轮 ASR 的迟到回调与静音计时器全部作废
    asrGen.current += 1;
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    const s = asrRef.current;
    asrRef.current = null;
    if (s) await s.stop().catch(() => undefined);
    setRecording(false);
  }, []);

  const nextWord = useCallback(() => {
    // 切题前立刻掐断正解播报，避免上一题的朗读串到下一题
    stopAnswerSpeech();
    clearTimers();
    setFeedback(null);
    setSpelling("");
    setMeaningText("");
    setLiveText("");
    liveTextRef.current = "";
    spellingRef.current = "";
    meaningRef.current = "";
    manualInputRef.current = false;
    manualTypingRef.current = false;
    setManualTyping(false);
    setHintOpen(false);
    setPhase("idle");
    setIndex((prev) => {
      const next = prev + 1;
      if (next >= items.length) {
        if (sessionId) {
          void fetch(withBase(`/api/sessions/${sessionId}/end`), { method: "POST" }).catch(
            () => undefined,
          );
        }
      }
      return next;
    });
  }, [clearTimers, items.length, sessionId, stopAnswerSpeech]);

  const submitAttempt = useCallback(
    async (transcriptOverride?: string) => {
      if (!sessionId || !current || submitLock.current || feedback) return;
      submitLock.current = true;
      setBusy(true);
      setError(null);
      clearTimers();
      // 「看提示」的朗读可能还在进行：判定前先掐断，避免与答错播报叠在一起
      stopAnswerSpeech();
      // 已提交：退出手动输入态，恢复自动流程的初始状态
      manualTypingRef.current = false;
      setManualTyping(false);
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
          setError("未获得识别文本。请开口作答、直接输入答案，或点「开始录音」重试。");
          setPhase("wait-record");
          setCountdown("点击「开始录音」继续");
          return;
        }

        // 手写答案可能在 TTS 播报期间提交：立即停播并作废播报后的自动开录流程
        wordGen.current += 1;
        stopTtsSpeech();

        const res = await fetch(withBase(`/api/sessions/${sessionId}/attempt`), {
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
          // 正确：绿勾区 + 叮咚，随即下一词（计时器纳入 clearTimers 统一清理）
          playSuccessChime();
          setFeedback(data);
          setPhase("feedback");
          if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
          autoNextTimer.current = setTimeout(() => {
            autoNextTimer.current = null;
            setFeedback(null);
            nextWord();
          }, 700);
          return;
        }

        // 错误：惋惜音 + 红叉 + 正解播报（释义×2 · 单词×2），可重试本词或直接下一个
        playFailChime();
        setFeedback(data);
        setPhase("feedback");
        void speakAnswer(data.answer);
      } finally {
        setBusy(false);
        submitLock.current = false;
      }
    },
    [
      sessionId,
      current,
      feedback,
      clearTimers,
      stopAsr,
      nextWord,
      speakAnswer,
      stopAnswerSpeech,
      stopTtsSpeech,
    ],
  );

  submitAttemptRef.current = submitAttempt;

  const startRealtime = useCallback(async () => {
    if (!current || recording || feedback || startingAsrRef.current) return;
    // 手动输入态下绝不自动开录；用户点「开始录音」时会先清掉该状态
    if (manualTypingRef.current) {
      setPhase("wait-record");
      setCountdown(null);
      return;
    }
    startingAsrRef.current = true;
    clearTimers();
    setError(null);
    setLiveText("");
    liveTextRef.current = "";
    speechSeenRef.current = false;
    const m =
      current.mode === "meaning" || current.mode === "cloze"
        ? "meaning"
        : "gloss";
    const gen = asrGen.current + 1;
    asrGen.current = gen;

    /** 出现新文本后重置 3 秒静音计时；静音满 3 秒自动停录并判定 */
    const touchSpeech = () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
        silenceTimer.current = null;
        if (asrGen.current !== gen) return;
        // 手动输入中不累计静音自动判定
        if (manualTypingRef.current) return;
        void submitAttemptRef.current();
      }, SILENCE_AFTER_SPEECH_MS);
    };

    const applyRecognizedText = (t: string) => {
      // 已停止 / 已切题：忽略迟到回调，避免旧会话污染新题
      if (asrGen.current !== gen) return;
      const text = t.trim();
      if (!text) return;
      liveTextRef.current = t;
      setLiveText(t);
      // 本题已手写作答：保留手写内容，ASR 结果只更新实时识别区，不回填输入框
      if (!manualInputRef.current) {
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
      }
      speechSeenRef.current = true;
      touchSpeech();
    };

    try {
      const session = new RealtimeAsrSession(
        {
          onPartial: applyRecognizedText,
          onFinal: applyRecognizedText,
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
      // 启动期间被手动结束 / 切题：立即收尾，绝不误设录音态
      if (asrGen.current !== gen || asrRef.current !== session) {
        await session.stop().catch(() => undefined);
        return;
      }
      setRecording(true);
      setPhase("recording");

      const autoSubmitSeconds = timersRef.current.autoSubmitSeconds;
      let left = autoSubmitSeconds;
      setCountdown(`录音中，${left}s 后自动判定`);
      tickTimer.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (tickTimer.current) clearInterval(tickTimer.current);
          tickTimer.current = null;
          setCountdown(null);
        } else {
          setCountdown(`录音中，${left}s 后自动判定`);
        }
      }, 1000);

      // 兜底上限：有识别文本才提交；一直没出声时不判错，保持录音等手动操作
      autoSubmitTimer.current = setTimeout(() => {
        autoSubmitTimer.current = null;
        if (asrGen.current !== gen) return;
        if (manualTypingRef.current) return;
        if (!speechSeenRef.current) {
          setCountdown("等待语音：请开口，或点「结束并判定」");
          return;
        }
        void submitAttemptRef.current();
      }, autoSubmitSeconds * 1000);
    } catch (e) {
      if (asrGen.current !== gen) return;
      setRecording(false);
      setMicOk(false);
      setPhase("wait-record");
      setError(e instanceof Error ? e.message : "无法开始实时识别");
    } finally {
      startingAsrRef.current = false;
    }
  }, [current, recording, feedback, clearTimers]);

  startRealtimeRef.current = startRealtime;

  /** 等待阶段（含 tts 播报中）点「开始录音」：立即停掉播报并开录 */
  const manualStartRecording = useCallback(() => {
    if (!current || recording || feedback) return;
    // 显式点「开始录音」：退出手动输入态，恢复自动流程
    manualTypingRef.current = false;
    setManualTyping(false);
    clearTimers();
    // 作废尚未结束的 TTS 后续流程，避免播报结束后再触发一次自动开录
    wordGen.current += 1;
    stopTtsSpeech();
    setPhase("wait-record");
    void startRealtimeRef.current();
  }, [current, recording, feedback, clearTimers, stopTtsSpeech]);

  /** 录音中点「结束并判定」：submitAttempt 内部会 stopAsr 并走原有判定流程 */
  const endRecordingAndJudge = useCallback(() => {
    void submitAttemptRef.current();
  }, []);

  /** 供 window 键盘监听调用；每次渲染同步为最新实现（含最新 props/state 闭包） */
  startSessionRef.current = startSession;
  endRecordingRef.current = endRecordingAndJudge;

  /**
   * 全局回车 / 空格快捷键（只在两种状态生效，其它状态一律放行给浏览器）：
   * - 未开始会话（sessionId 为空）：等同点「开始听写」→ startSession()
   * - 录音中（recording）：等同点「结束并判定」→ endRecordingAndJudge()
   * 跳过长按重复、中文输入法组合、输入框/可编辑区、以及 Ctrl/Meta/Alt 组合键。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.repeat) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const isConfirmKey =
        event.key === "Enter" || event.key === " " || event.key === "Spacebar";
      const isNextKey = event.key === "ArrowRight";
      if (!isConfirmKey && !isNextKey) return;
      if (isEditableTarget(event.target)) return;

      // 通过 ref 读取最新状态，避免监听闭包停留在首次渲染的旧值
      const {
        sessionId: latestSessionId,
        recording: latestRecording,
        feedback: latestFeedback,
        busy: latestBusy,
      } = latestRef.current;

      if (!latestSessionId) {
        if (!isConfirmKey || latestBusy) return;
        event.preventDefault();
        startSessionRef.current();
        return;
      }

      // 已出反馈：→ 下一个单词，空格/回车 重试本词
      if (latestFeedback) {
        if (latestBusy) return;
        event.preventDefault();
        if (isNextKey) nextWordRef.current();
        else retryWordRef.current();
        return;
      }

      // 录音中：空格/回车 结束并判定；→ 不打断录音，避免误触
      if (latestRecording) {
        if (!isConfirmKey || latestBusy) return;
        event.preventDefault();
        endRecordingRef.current();
        return;
      }

      // 其余等待状态：→ 跳过当前词
      if (isNextKey && !latestBusy) {
        event.preventDefault();
        nextWordRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const beginTimersAfterTts = useCallback(
    (item: QueueItem, immediate = false) => {
      // 播报（模式 A 读释义 / 模式 B 读单词）结束后默认自动开录；
      // 麦克风权限已在点模式/开始听写时申请过，这里通常不会再弹窗。
      void item;
      setPhase("wait-record");
      // 用户已在输入框手动作答：不安排自动开录，保持等待
      if (manualTypingRef.current) {
        setCountdown(null);
        return;
      }
      setCountdown(immediate ? "正在开始录音…" : "即将自动录音…");
      if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
      autoStartTimer.current = setTimeout(
        () => {
          autoStartTimer.current = null;
          if (manualTypingRef.current) {
            setPhase("wait-record");
            setCountdown(null);
            return;
          }
          void startRealtimeRef.current();
        },
        immediate ? 0 : 450,
      );
    },
    [],
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
    manualInputRef.current = false;
    manualTypingRef.current = false;
    setManualTyping(false);
    setHintOpen(false);
    setError(null);
    submitLock.current = false;
    setPhase("tts");
    setCountdown("正在播报…");

    void (async () => {
      await speakEntry(current, gen);
      if (wordGen.current !== gen) return;
      beginTimersAfterTts(current);
    })();

    return () => {
      wordGen.current += 1;
      clearTimers();
      void stopAsr();
      stopTtsSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, index, current?.entryId]);

  const retryCurrent = useCallback(() => {
    if (!current) return;
    // 重试前立刻掐断正解播报（含 🔊 单遍朗读）
    stopAnswerSpeech();
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
    manualInputRef.current = false;
    manualTypingRef.current = false;
    setManualTyping(false);
    setHintOpen(false);
    submitLock.current = false;
    setPhase("tts");
    setCountdown("正在播报…");
    void (async () => {
      await speakEntry(current, gen);
      if (wordGen.current !== gen) return;
      // 重试：播报结束后回到等待态，由用户点「开始录音」开录
      beginTimersAfterTts(current, true);
    })();
  }, [current, clearTimers, speakEntry, beginTimersAfterTts, stopAnswerSpeech]);

  // 全局快捷键通过 ref 派发，保证拿到最新闭包
  useEffect(() => {
    nextWordRef.current = nextWord;
    retryWordRef.current = retryCurrent;
  });

  useEffect(() => {
    return () => {
      clearTimers();
      void stopAsr();
      stopAnswerSpeech();
      stopTtsSpeech();
    };
  }, [clearTimers, stopAsr, stopAnswerSpeech, stopTtsSpeech]);

  /** 清空会话状态，回到「未开始」的单屏布局（不自动开始新一轮） */
  function resetToIdle() {
    // 作废尚未结束的 TTS 流程与正解播报，再停 ASR / 计时器
    wordGen.current += 1;
    clearTimers();
    void stopAsr();
    stopAnswerSpeech();
    stopTtsSpeech();
    submitLock.current = false;
    setSessionId(null);
    setItems([]);
    setIndex(0);
    setSpelling("");
    setMeaningText("");
    setLiveText("");
    liveTextRef.current = "";
    spellingRef.current = "";
    meaningRef.current = "";
    manualInputRef.current = false;
    manualTypingRef.current = false;
    setManualTyping(false);
    setHintOpen(false);
    setFeedback(null);
    setTtsNote(null);
    setPhase("idle");
    setCountdown(null);
    setSettingsHint(null);
  }

  /** 「重新开始」：先确认（避免误点丢进度），结束当前会话后按当前模式/范围重开 */
  function restartSession() {
    if (sessionId) {
      const confirmed = window.confirm(
        "重新开始会结束当前会话并从第 1 词重来，确定吗？",
      );
      if (!confirmed) return;
      void fetch(withBase(`/api/sessions/${sessionId}/end`), { method: "POST" }).catch(
        () => undefined,
      );
    }
    resetToIdle();
    void startSession();
  }

  /** 会话未开跑时切换即生效；正在跑则只改 state 并提示需「重新开始」 */
  function changeMode(next: DictationMode) {
    if (next === selectedMode) return;
    setSelectedMode(next);
    if (!sessionId || next === mode) {
      setSettingsHint(null);
      return;
    }
    setSettingsHint(
      `已切换为${next === "gloss" ? "模式 A" : "模式 B"}，点「重新开始」生效`,
    );
  }

  function changeSource(next: QueueSource) {
    if (next === source) return;
    setSource(next);
    if (!sessionId || next === sessionSource) {
      setSettingsHint(null);
      return;
    }
    const label =
      RANGE_OPTIONS.find((option) => option.value === next)?.label ?? next;
    setSettingsHint(`已切换范围：${label}，点「重新开始」生效`);
  }

  if (sessionId && index >= items.length) {
    return (
      <div className="flex h-full w-full flex-col gap-2">
        <div className="panel m-auto w-full max-w-md space-y-4 p-6 text-center">
          <h1 className="font-display text-2xl">本轮完成</h1>
          <p className="text-sm text-[var(--muted)]">共完成 {items.length} 词。</p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-xs"
              onClick={resetToIdle}
            >
              返回听写
            </button>
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={() => {
                resetToIdle();
                void startSession();
              }}
            >
              再听一轮
            </button>
          </div>
        </div>
      </div>
    );
  }

  const liveSegments = mode === "meaning" ? segmentChinese(liveText) : [];
  const modeLabel =
    selectedMode === "gloss" ? "模式 A · 中文→拼写" : "模式 B · 单词→中文";
  const rangeLabel =
    RANGE_OPTIONS.find((option) => option.value === source)?.label ?? source;
  const activeModeLabel =
    mode === "gloss" ? "模式 A · 中文→拼写" : "模式 B · 单词→中文";
  const activeRangeLabel =
    RANGE_OPTIONS.find((option) => option.value === sessionSource)?.label ??
    sessionSource;
  const total = items.length;
  const progressLabel = sessionId
    ? `第 ${Math.min(index + 1, total)}/${total} 词`
    : "尚未开始";
  const micLabel = recording
    ? "● 录音中"
    : micOk
      ? "麦克风已就绪"
      : "麦克风待授权";
  const settingsBtnClass = (active: boolean) =>
    `rounded-md border px-2 py-1 transition ${
      active
        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
        : "border-[var(--line)] text-[var(--ink)] hover:border-[var(--accent)]"
    }`;

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {/* 顶部工具栏：模式 / 范围 / 开始·重新开始 + 状态行（不随内容滚动） */}
      <div className="panel shrink-0 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs">
          <span className="text-[var(--muted)]">模式</span>
          <button
            type="button"
            className={settingsBtnClass(selectedMode === "gloss")}
            aria-pressed={selectedMode === "gloss"}
            onClick={() => changeMode("gloss")}
          >
            模式 A
          </button>
          <button
            type="button"
            className={settingsBtnClass(selectedMode === "meaning")}
            aria-pressed={selectedMode === "meaning"}
            onClick={() => changeMode("meaning")}
          >
            模式 B
          </button>

          <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />

          <span className="text-[var(--muted)]">范围</span>
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={settingsBtnClass(source === option.value)}
              aria-pressed={source === option.value}
              onClick={() => changeSource(option.value)}
            >
              {option.label}
            </button>
          ))}

          <button
            type="button"
            className="btn-primary ml-auto shrink-0 px-3 py-1 text-xs"
            disabled={busy}
            onClick={() => {
              if (sessionId) {
                restartSession();
              } else {
                void startSession();
              }
            }}
          >
            {sessionId ? "重新开始" : busy ? "准备中…" : "开始听写"}
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className="text-[var(--muted)]">{progressLabel}</span>
          {sessionId && <span className="badge">{activeModeLabel}</span>}
          {sessionId && <span className="badge">{activeRangeLabel}</span>}
          <span
            className={`rounded px-2 py-0.5 ${
              recording
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "bg-[var(--chip)] text-[var(--muted)]"
            }`}
          >
            {micLabel}
          </span>
          {countdown && (
            <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--accent)]">
              {countdown}
            </span>
          )}
          {ttsNote && (
            <span className="rounded bg-[var(--chip)] px-2 py-0.5 text-[var(--muted)]">
              {ttsNote}
              {phase === "tts" ? " · 播报中" : ""}
            </span>
          )}
          {settingsHint && (
            <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--accent)]">
              {settingsHint}
            </span>
          )}
        </div>
      </div>

      {/* 作答区：占满剩余高度，只在内部滚动，页面不出现滚动条 */}
      <div className="panel flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        {!sessionId || !current ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="font-display text-lg">点上方「开始听写」开始本轮</p>
            <p className="text-xs text-[var(--muted)]">
              {`${modeLabel} · 范围：${rangeLabel}`}
            </p>
            <p className="max-w-md text-xs text-[var(--muted)]">
              {`答对自动下一词；答错可「重试本词」或「下一个」，并朗读正解（释义×${ANSWER_REPEAT} · 单词×${ANSWER_REPEAT}）。`}
            </p>
            <p className="max-w-md text-xs text-[var(--muted)]">
              进入页面已自动申请麦克风；未授权只在此提示，不影响进入听写。
            </p>
            {error && (
              <p className="max-w-md rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                {error}
              </p>
            )}
          </div>
        ) : (
          <>
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
          {!feedback && (
            <span className="text-xs text-[var(--muted)]">
              {manualTyping
                ? "手动输入中，回车判定"
                : phase === "tts"
                  ? "播报结束后自动开录"
                  : recording
                    ? "录音中，静音 3 秒自动判定"
                    : "等待开录"}
            </span>
          )}
          {!feedback && !recording && !busy && (phase === "tts" || phase === "wait-record") && (
            <button
              type="button"
              className="btn-primary px-2 py-0.5 text-xs"
              onClick={manualStartRecording}
            >
              ▶ 开始录音
            </button>
          )}
          {!feedback && recording && (
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              disabled={busy}
              onClick={endRecordingAndJudge}
            >
              ■ 结束并判定
            </button>
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

        <section className="no-scrollbar max-h-[50vh] shrink-0 space-y-2 overflow-y-auto rounded-lg border border-[var(--line)] p-2.5">
          <p className="label mb-0">判定区</p>

          {!feedback ? (
            <>
              {/* 手写（键盘）作答：模式 A 输入英文拼写，模式 B 输入中文释义 */}
              <div className="flex items-center gap-1.5">
                <input
                  className="field min-w-0 flex-1 text-sm"
                  placeholder={
                    mode === "gloss" ? "也可以直接输入拼写" : "也可以直接输入中文释义"
                  }
                  value={mode === "gloss" ? spelling : meaningText}
                  onFocus={() => {
                    // 聚焦作答输入框：立刻停录并进入手动输入态，不自动开录、不自动判定
                    manualTypingRef.current = true;
                    setManualTyping(true);
                    void stopAsr();
                    clearTimers();
                    setPhase((prev) => (prev === "recording" ? "wait-record" : prev));
                  }}
                  onChange={(e) => {
                    const value = e.target.value;
                    manualInputRef.current = true;
                    if (mode === "gloss") {
                      spellingRef.current = value;
                      setSpelling(value);
                    } else {
                      meaningRef.current = value;
                      setMeaningText(value);
                    }
                  }}
                  onKeyDown={(e) => {
                    // 输入法组合期间（拼音选词）的回车 / 空格交给输入法，不提交
                    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                      return;
                    }
                    // 目标词含空格（短语）时空格照常输入，避免无法输入空格
                    const spaceSubmits = e.key === " " && !/\s/.test(current.word);
                    if (e.key === "Enter" || spaceSubmits) {
                      e.preventDefault();
                      // 清掉静音 3 秒与自动判定计时器，避免与手动提交重复
                      clearTimers();
                      void submitAttemptRef.current();
                    }
                  }}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label={mode === "gloss" ? "手写拼写" : "手写中文释义"}
                />
                <button
                  type="button"
                  className="btn-primary shrink-0 px-2 py-1 text-xs"
                  disabled={busy}
                  onClick={() => {
                    void submitAttemptRef.current();
                  }}
                >
                  判定
                </button>
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-2 py-1 text-xs"
                  aria-expanded={hintOpen}
                  onClick={toggleHint}
                >
                  {hintOpen ? "收起提示" : "看提示"}
                </button>
              </div>
              {hintOpen && (
                <div className="rounded-md border border-[var(--line)] bg-[var(--chip)]/60 px-2 py-1.5 text-xs leading-snug">
                  <p>
                    <span className="rounded bg-[var(--accent-soft)] px-1 py-0.5 text-[var(--accent)]">
                      正解
                    </span>
                    <span className="ml-1.5 font-display text-sm text-[var(--ink)]">
                      {current.word}
                    </span>
                    <span className="ml-1.5 text-[var(--muted)]">
                      {current.pos || "—"}
                    </span>
                    <span className="ml-1.5 text-[var(--ink)]">
                      {current.glossZh || "—"}
                    </span>
                  </p>
                  {current.example && (
                    <p className="mt-0.5 break-words text-[var(--muted)]">
                      例：{current.example}
                    </p>
                  )}
                </div>
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
              <div className="relative rounded-md bg-[var(--danger-soft)] px-3 py-1.5 pr-9 text-center text-sm text-[var(--danger)]">
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
                <button
                  type="button"
                  aria-label="重听英文单词发音"
                  title="再听一遍单词发音"
                  className="absolute top-1 right-1 rounded p-1 text-xs leading-none transition hover:bg-black/10 active:scale-95"
                  onClick={() => {
                    void replayAnswerWord(feedback.answer.word);
                  }}
                >
                  🔊
                </button>
              </div>
              <AnswerCard answer={feedback.answer} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[var(--muted)]">
                  {`正解播报：释义×${ANSWER_REPEAT} · 单词×${ANSWER_REPEAT}`}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1 text-xs"
                    onClick={nextWord}
                  >
                    下一个
                  </button>
                  <button
                    type="button"
                    className="btn-primary px-3 py-1 text-xs"
                    onClick={retryCurrent}
                  >
                    重试本词
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
          </>
        )}
      </div>
    </div>
  );
}
