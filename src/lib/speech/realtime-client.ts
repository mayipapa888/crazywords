"use client";

import { withBase } from "@/lib/base-path";
import { extractLemmaFromTranscript } from "./extract-lemma";

export type RealtimeAsrHandlers = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: Error) => void;
  onStarted?: () => void;
  onStopped?: () => void;
};

export type RealtimeAsrOptions = {
  /** 模式 A 目标英文词；模式 B 可传中文释义作 mock 目标 */
  targetText?: string;
  /** en：拼写朗读；zh：释义口述（AppKey 模型需匹配） */
  language?: "en" | "zh";
};

/** 建立 WebSocket 连接的超时（ms） */
const CONNECT_TIMEOUT_MS = 10000;
/** 发出 StopTranscription 后等待网关收尾（TranscriptionCompleted / close）的上限（ms） */
const STOP_TIMEOUT_MS = 1000;

/**
 * 会话状态机：idle → starting → running → stopping → closed。
 * 只有 running 阶段允许向网关发送音频帧；stopping/closed 一律丢帧。
 */
type SessionPhase = "idle" | "starting" | "running" | "stopping" | "closed";

function uuid32() {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/**
 * NLS 实时识别只接受 8k/16k、16bit、单声道 PCM。浏览器 AudioContext 默认常是
 * 44100/48000Hz，必须先正确重采样再发送。
 *
 * 降采样时先做半窗滑动平均（简易抗混叠低通）再抽取：直接每 N 点抽一个会把
 * 8kHz 以上的高频（英文 s/f/th 等齿音）混叠回语音频段，明显拉低拼写识别率。
 * 升采样用线性插值；目标采样率相同则原样返回。
 */
function resamplePcm(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (!inRate || inRate === outRate || input.length === 0) return input;
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);

  if (ratio > 1) {
    const half = ratio / 2;
    for (let i = 0; i < outLen; i++) {
      const center = (i + 0.5) * ratio - 0.5;
      const start = Math.max(0, Math.ceil(center - half));
      const end = Math.min(input.length - 1, Math.floor(center + half));
      let sum = 0;
      let count = 0;
      for (let j = start; j <= end; j++) {
        sum += input[j];
        count += 1;
      }
      out[i] = count > 0 ? sum / count : 0;
    }
    return out;
  }

  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/**
 * 优先让浏览器按目标采样率采集/重采样（16k 时无需再处理）；
 * 老浏览器不支持带 sampleRate 的构造参数时回退默认采样率，由 resamplePcm 兜底。
 */
function createAudioContext(sampleRate: number): AudioContext {
  try {
    return new AudioContext({ sampleRate, latencyHint: "interactive" });
  } catch {
    return new AudioContext();
  }
}

/** 建连到 TranscriptionStarted 之间最多缓存 3 秒音频，避免丢掉用户开口的第一个词。 */
const MAX_PREROLL_BYTES = 16000 * 2 * 3;

/** 服务端签发的实时识别参数（来自 /api/speech/nls-token，均可选、缺省用安全默认）。 */
type AsrSessionPayload = {
  sampleRate?: number;
  enableIntermediateResult?: boolean;
  enablePunctuationPrediction?: boolean;
  maxSentenceSilence?: number;
  vocabularyId?: string;
  customizationId?: string;
};

type TokenPayload = {
  provider: string;
  mock: boolean;
  token?: string;
  appkey?: string;
  wsUrl?: string;
  expireTime?: number;
  asr?: AsrSessionPayload;
};

/**
 * 浏览器端实时 ASR：
 * - aliyun：WebSocket SpeechTranscriber（需项目开通实时语音识别）
 * - mock：本地模拟边说边出字
 */
export class RealtimeAsrSession {
  private handlers: RealtimeAsrHandlers;
  private targetText?: string;
  private language: "en" | "zh";
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private taskId = "";
  private appkey = "";
  /** 状态机；只有 running 才允许发送音频帧 */
  private phase: SessionPhase = "idle";
  /** stop() 已被调用（同步置位，先于任何 await）；音频发送路径据此丢帧 */
  private stopRequested = false;
  /** stop() 幂等载体：重复/并发调用复用同一个 Promise */
  private stopPromise: Promise<void> | null = null;
  /** 是否已进入 stop() 流程，防止重入时重复下发停止指令 */
  private stopStarted = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  /** 唤醒 startAliyun 中等待建连的 Promise（建连被 stop() 打断时用） */
  private settleConnect: ((err?: Error) => void) | null = null;
  /** 唤醒 stop() 中等待网关收尾的 Promise */
  private finishStopWait: (() => void) | null = null;
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private lastText = "";
  /** 已确认句子累计（SentenceEnd） */
  private committed = "";
  /** 当前句中间结果 */
  private interim = "";
  /** 目标采样率（NLS 只支持 8k/16k），由服务端 asr 配置决定 */
  private targetRate: 8000 | 16000 = 16000;
  /** 收到 TranscriptionStarted 前先缓存 PCM，避免丢掉用户开口的第一个词 */
  private audioReady = false;
  private pendingAudio: ArrayBuffer[] = [];
  private pendingBytes = 0;
  /** 静音增益：给 ScriptProcessor 一条到 destination 的通路，但不外放麦克风（防回声） */
  private sink: GainNode | null = null;

  constructor(handlers: RealtimeAsrHandlers, options?: RealtimeAsrOptions | string) {
    this.handlers = handlers;
    if (typeof options === "string") {
      this.targetText = options;
      this.language = "en";
    } else {
      this.targetText = options?.targetText;
      this.language = options?.language || "en";
    }
  }

  get transcript() {
    return this.lastText;
  }

  private publishText(text: string, finalSentence = false) {
    this.lastText = text;
    this.handlers.onPartial?.(text);
    if (finalSentence) this.handlers.onFinal?.(text);
  }

  private combineDisplay() {
    return [this.committed, this.interim].filter((s) => s.trim()).join(" ").trim();
  }

  get lemma() {
    return extractLemmaFromTranscript(this.lastText, this.targetText);
  }

  async start() {
    // 启动/运行/停止中重复 start 直接忽略（与原语义一致）；closed 后允许重新启动
    if (this.phase === "starting" || this.phase === "running" || this.phase === "stopping") {
      return;
    }
    this.phase = "starting";
    this.stopRequested = false;
    this.stopStarted = false;
    this.stopPromise = null;

    try {
      const tokenRes = await fetch(withBase("/api/speech/nls-token"), { method: "POST" });
      const cred = (await tokenRes.json()) as TokenPayload & { error?: string };
      if (this.stopRequested) return; // 启动期间已被 stop()：静默放弃
      if (!tokenRes.ok) {
        throw new Error(
          cred.error ||
            "获取实时识别 Token 失败。SPEECH_PROVIDER=aliyun 时请配置 ASR_* 并开通「实时语音识别」。",
        );
      }

      this.targetRate = cred.asr?.sampleRate === 8000 ? 8000 : 16000;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          // ideal 只是建议，浏览器不支持也绝不报错；返回的流由 AudioContext 再统一到目标采样率
          sampleRate: { ideal: this.targetRate },
        },
      });
      if (this.stopRequested) {
        // stop() 在 getUserMedia 期间抢先执行，doStop 看不到这个新 stream，这里自己释放
        this.cleanupAudio();
        this.phase = "closed";
        return;
      }

      // 仅服务端明确返回 mock 时走本地模拟；aliyun 缺凭证由接口 502，不会静默降级
      if (cred.mock || cred.provider === "mock") {
        await this.startMock();
        return;
      }

      if (cred.provider !== "aliyun") {
        throw new Error(
          `未知实时识别提供方：${cred.provider || "?"}。请设 SPEECH_PROVIDER=aliyun 或 mock。`,
        );
      }

      if (!cred.token || !cred.appkey || !cred.wsUrl) {
        throw new Error(
          "实时识别凭证不完整（缺 token/appkey/wsUrl）。请检查 ASR_* 与 NLS_WS_URL。",
        );
      }
      this.appkey = cred.appkey;
      await this.startAliyun(cred.token, cred.appkey, cred.wsUrl, cred.asr);
    } catch (e) {
      // 启动失败：释放麦克风与 socket，避免遗留采集
      this.cleanupAudio();
      this.teardownSocket();
      this.phase = "closed";
      if (this.stopRequested) return; // 主动 stop() 引起的失败不打扰界面
      throw e;
    }
  }

  private async startMock() {
    this.phase = "running";
    this.handlers.onStarted?.();
    this.committed = "";
    this.interim = "";
    const fallback = this.language === "zh" ? "放弃" : "hello";
    const target =
      this.language === "zh"
        ? (this.targetText || fallback).replace(/[^\u4e00-\u9fff]/g, "") || fallback
        : (this.targetText || fallback).toLowerCase();
    let i = 0;
    this.mockTimer = setInterval(() => {
      if (this.phase !== "running") return; // 停止过程中不再产出文本
      i += 1;
      const step = this.language === "zh" ? 1 : Math.ceil(i / 2);
      const partial = target.slice(0, Math.min(target.length, this.language === "zh" ? i : step));
      this.interim = partial;
      this.publishText(this.combineDisplay(), partial === target);
      if (partial === target) {
        this.committed = this.combineDisplay();
        this.interim = "";
      }
    }, 400);
  }

  private async startAliyun(
    token: string,
    appkey: string,
    wsUrl: string,
    asr?: AsrSessionPayload,
  ) {
    this.taskId = uuid32();
    this.audioReady = false;
    this.pendingAudio = [];
    this.pendingBytes = 0;
    const url = `${wsUrl}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        this.settleConnect = null;
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        if (err) reject(err);
        else resolve();
      };
      this.settleConnect = finish;
      ws.onopen = () => finish();
      ws.onerror = () => finish(new Error("连接阿里云实时识别失败"));
      ws.onclose = () => finish(new Error("实时识别连接已关闭"));
      this.connectTimer = setTimeout(
        () => finish(new Error("连接实时识别超时")),
        CONNECT_TIMEOUT_MS,
      );
    });

    // stop() 在建连期间赢了竞态：不再开任务、不再挂音频管线
    if (this.stopRequested || this.ws !== ws) return;

    this.committed = "";
    this.interim = "";

    ws.onmessage = (ev) => this.handleServerMessage(ev);

    const startMsg = {
      header: {
        message_id: uuid32(),
        task_id: this.taskId,
        namespace: "SpeechTranscriber",
        name: "StartTranscription",
        appkey,
      },
      payload: {
        format: "pcm",
        sample_rate: this.targetRate,
        enable_intermediate_result: asr?.enableIntermediateResult !== false,
        enable_punctuation_prediction: asr?.enablePunctuationPrediction === true,
        // 官方说明 ITN 只把中文数字转阿拉伯数字；英文拼写模式下关掉，避免 one/two 被转成 1/2
        enable_inverse_text_normalization: this.language === "zh",
        max_sentence_silence: asr?.maxSentenceSilence ?? 800,
        ...(asr?.vocabularyId ? { vocabulary_id: asr.vocabularyId } : {}),
        ...(asr?.customizationId ? { customization_id: asr.customizationId } : {}),
      },
    };
    try {
      ws.send(JSON.stringify(startMsg));
    } catch {
      throw new Error("启动实时识别失败：无法发送 StartTranscription");
    }
    this.phase = "running";

    // Audio pipeline：优先让浏览器直接跑在目标采样率上，失败时回退由 resamplePcm 兜底
    const ctx = createAudioContext(this.targetRate);
    this.audioCtx = ctx;
    const source = ctx.createMediaStreamSource(this.stream!);
    this.source = source;
    // ScriptProcessor 兼容性好；约 100~130ms 一帧，与 NLS 推荐分片大小一致
    const frameSamples = this.targetRate === 8000 ? 1024 : 2048;
    const processor = ctx.createScriptProcessor(frameSamples, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = (e) => {
      // 关键闸门：stopping/closed 状态直接丢帧，绝不 send（否则网关报 TASK_STATE_ERROR）
      if (this.stopRequested || this.phase !== "running") return;
      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(resamplePcm(input, ctx.sampleRate, this.targetRate));
      if (!this.audioReady) {
        // TranscriptionStarted 之前先攒着，收到后再按顺序补发，避免开头丢字
        if (this.pendingBytes + pcm.byteLength <= MAX_PREROLL_BYTES) {
          this.pendingAudio.push(pcm);
          this.pendingBytes += pcm.byteLength;
        }
        return;
      }
      try {
        socket.send(pcm);
      } catch {
        // socket 正在收尾：丢弃这一帧
      }
    };
    // 用 0 增益节点接到 destination：保留处理链路，但不把麦克风外放（否则会回声/啸叫）
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.sink = sink;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);
  }

  /** 收到 TranscriptionStarted：解锁发送并补发建连期间缓存的 PCM。 */
  private markAudioReady() {
    this.audioReady = true;
    const pending = this.pendingAudio;
    this.pendingAudio = [];
    this.pendingBytes = 0;
    const socket = this.ws;
    if (this.stopRequested || !socket || socket.readyState !== WebSocket.OPEN) return;
    for (const frame of pending) {
      try {
        socket.send(frame);
      } catch {
        break;
      }
    }
  }

  /**
   * 停止识别。幂等：并发/重复调用返回同一个 Promise，
   * 不会重复发 StopTranscription，也不会重复 close。
   */
  stop(): Promise<void> {
    if (!this.stopStarted) {
      this.stopStarted = true;
      this.stopPromise = this.doStop();
    }
    return this.stopPromise ?? Promise.resolve();
  }

  private async doStop(): Promise<void> {
    // 从未启动 / 已经收尾：不发停止指令，直接结束
    if (this.phase === "idle" || this.phase === "closed") {
      this.phase = "closed";
      return;
    }

    // ① 同步进入 stopping：自此所有音频发送路径全部丢帧
    this.stopRequested = true;
    this.phase = "stopping";

    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
      this.handlers.onFinal?.(this.lastText);
    }

    // ② 先停麦克风采集：断音频图 + 关 AudioContext + 停 track，并清空 onaudioprocess。
    //    ScriptProcessor 是即时 send、没有独立发送队列，残留帧由上面的闸门丢弃。
    this.cleanupAudio();

    // ③ 再下发 StopTranscription，等网关收尾或超时
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      let sent = false;
      try {
        const stopMsg = {
          header: {
            message_id: uuid32(),
            task_id: this.taskId,
            namespace: "SpeechTranscriber",
            name: "StopTranscription",
            appkey: this.appkey,
          },
        };
        ws.send(JSON.stringify(stopMsg));
        sent = true;
      } catch {
        // 发送失败：跳过等待，直接收尾
      }
      if (sent) await this.waitForStopSettled(ws);
    }

    // ④ 清理 socket、定时器与事件监听
    this.teardownSocket();
    this.phase = "closed";
    this.handlers.onStopped?.();
  }

  /** 等待 TranscriptionCompleted 或 socket close，超时兜底必定 resolve */
  private waitForStopSettled(ws: WebSocket): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.stopTimer) {
          clearTimeout(this.stopTimer);
          this.stopTimer = null;
        }
        this.finishStopWait = null;
        ws.removeEventListener("close", finish);
        resolve();
      };
      this.finishStopWait = finish;
      ws.addEventListener("close", finish);
      this.stopTimer = setTimeout(finish, STOP_TIMEOUT_MS);
      // 挂监听前 socket 就已经断开的情况
      if (ws.readyState !== WebSocket.OPEN) finish();
    });
  }

  private teardownSocket() {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const settleStop = this.finishStopWait;
    this.finishStopWait = null;
    settleStop?.();

    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    // start() 可能还卡在等建连：立即结束它，避免 stop() 后仍要等满 10s 超时
    this.settleConnect?.(new Error("实时识别已停止"));

    ws.onopen = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onclose = null;
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch {
      // ignore
    }
  }

  private handleServerMessage(ev: MessageEvent) {
    if (typeof ev.data !== "string") return;
    try {
      const msg = JSON.parse(ev.data) as {
        header?: { name?: string; status?: number; status_text?: string };
        payload?: { result?: string; index?: number };
      };
      const name = msg.header?.name;
      const statusText = msg.header?.status_text || "";
      const stopping =
        this.stopRequested || this.phase === "stopping" || this.phase === "closed";

      // 停止收尾阶段网关会回 "Gateway:TASK_STATE_ERROR:Got stream data while task is stopping!"，
      // 是 StopTranscription 后仍在途的最后一帧造成的预期噪音，直接忽略、不打扰界面
      if (stopping && /TASK_STATE_ERROR|Got stream data while task is stopping/i.test(statusText)) {
        return;
      }

      if (name === "TranscriptionStarted") {
        if (!stopping) {
          // 服务端准备好收音频了：先补发缓存的 PCM，再通知界面已启动
          this.markAudioReady();
          this.handlers.onStarted?.();
        }
      } else if (name === "TranscriptionResultChanged") {
        // 当前句中间结果：替换 interim，保留已累计句子
        this.interim = msg.payload?.result || "";
        this.publishText(this.combineDisplay());
      } else if (name === "SentenceEnd") {
        // 句子结束：并入累计全文，继续显示
        const sentence = (msg.payload?.result || "").trim();
        if (sentence) {
          this.committed = [this.committed, sentence].filter(Boolean).join(" ").trim();
        }
        this.interim = "";
        this.publishText(this.combineDisplay(), true);
      } else if (name === "TranscriptionCompleted") {
        const finalText = (msg.payload?.result || "").trim();
        // 优先保留累计全文；若服务端给了更长整段则采用
        if (finalText && finalText.length >= this.combineDisplay().length) {
          this.committed = finalText;
          this.interim = "";
        } else if (this.interim) {
          this.committed = this.combineDisplay();
          this.interim = "";
        }
        this.publishText(this.combineDisplay(), true);
        // 网关收尾完成：立刻结束 stop() 的等待
        this.finishStopWait?.();
      } else if (name === "TaskFailed") {
        // 只有正常录音状态下的故障才上报；停止/关闭阶段的失败属于收尾噪音
        if (stopping) return;
        this.handlers.onError?.(
          new Error(statusText || `实时识别失败 status=${msg.header?.status}`),
        );
      }
    } catch {
      // ignore
    }
  }

  private cleanupAudio() {
    const processor = this.processor;
    const source = this.source;
    const sink = this.sink;
    const ctx = this.audioCtx;
    const stream = this.stream;
    this.processor = null;
    this.source = null;
    this.sink = null;
    this.audioCtx = null;
    this.stream = null;
    this.audioReady = false;
    this.pendingAudio = [];
    this.pendingBytes = 0;

    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        // ignore
      }
    }
    try {
      sink?.disconnect();
    } catch {
      // ignore
    }
    try {
      source?.disconnect();
    } catch {
      // ignore
    }
    try {
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    } catch {
      // ignore
    }
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
  }
}
