"use client";

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

/** 将任意采样率音频降/升采样到 16k */
function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === 16000) return input;
  const ratio = inRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = input[Math.floor(i * ratio)] || 0;
  }
  return out;
}

type TokenPayload = {
  provider: string;
  mock: boolean;
  token?: string;
  appkey?: string;
  wsUrl?: string;
  expireTime?: number;
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
  private running = false;
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private lastText = "";
  /** 已确认句子累计（SentenceEnd） */
  private committed = "";
  /** 当前句中间结果 */
  private interim = "";

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
    if (this.running) return;
    const tokenRes = await fetch("/api/speech/nls-token", { method: "POST" });
    const cred = (await tokenRes.json()) as TokenPayload & { error?: string };
    if (!tokenRes.ok) {
      throw new Error(
        cred.error ||
          "获取实时识别 Token 失败。SPEECH_PROVIDER=aliyun 时请配置 ASR_* 并开通「实时语音识别」。",
      );
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.running = true;

    // 仅服务端明确返回 mock 时走本地模拟；aliyun 缺凭证由接口 502，不会静默降级
    if (cred.mock || cred.provider === "mock") {
      await this.startMock();
      return;
    }

    if (cred.provider !== "aliyun") {
      this.running = false;
      throw new Error(
        `未知实时识别提供方：${cred.provider || "?"}。请设 SPEECH_PROVIDER=aliyun 或 mock。`,
      );
    }

    if (!cred.token || !cred.appkey || !cred.wsUrl) {
      this.running = false;
      throw new Error(
        "实时识别凭证不完整（缺 token/appkey/wsUrl）。请检查 ASR_* 与 NLS_WS_URL。",
      );
    }
    this.appkey = cred.appkey;
    await this.startAliyun(cred.token, cred.appkey, cred.wsUrl);
  }

  private async startMock() {
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

  private async startAliyun(token: string, appkey: string, wsUrl: string) {
    this.taskId = uuid32();
    const url = `${wsUrl}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("WebSocket 未创建"));
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("连接阿里云实时识别失败"));
      setTimeout(() => reject(new Error("连接实时识别超时")), 10000);
    });

    this.committed = "";
    this.interim = "";

    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as {
          header?: { name?: string; status?: number; status_text?: string };
          payload?: { result?: string; index?: number };
        };
        const name = msg.header?.name;
        if (name === "TranscriptionStarted") {
          this.handlers.onStarted?.();
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
        } else if (name === "TaskFailed") {
          this.handlers.onError?.(
            new Error(msg.header?.status_text || `实时识别失败 status=${msg.header?.status}`),
          );
        }
      } catch {
        // ignore
      }
    };

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
        sample_rate: 16000,
        enable_intermediate_result: true,
        enable_punctuation_prediction: false,
        enable_inverse_text_normalization: true,
      },
    };
    this.ws.send(JSON.stringify(startMsg));

    // Audio pipeline
    this.audioCtx = new AudioContext();
    this.source = this.audioCtx.createMediaStreamSource(this.stream!);
    // ScriptProcessor 兼容性好；buffer 4096
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const down = downsampleTo16k(input, this.audioCtx!.sampleRate);
      const pcm = floatTo16BitPCM(down);
      this.ws.send(pcm);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;

    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
      this.handlers.onFinal?.(this.lastText);
    }

    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const stopMsg = {
          header: {
            message_id: uuid32(),
            task_id: this.taskId,
            namespace: "SpeechTranscriber",
            name: "StopTranscription",
            appkey: this.appkey,
          },
        };
        this.ws.send(JSON.stringify(stopMsg));
        await new Promise((r) => setTimeout(r, 300));
        this.ws.close();
      }
    } catch {
      // ignore
    }

    this.cleanupAudio();
    this.handlers.onStopped?.();
  }

  private cleanupAudio() {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      void this.audioCtx?.close();
    } catch {
      // ignore
    }
    this.processor = null;
    this.source = null;
    this.audioCtx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ws = null;
  }
}
