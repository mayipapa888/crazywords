"use client";

import { extractLemmaFromTranscript } from "./extract-lemma";

export type RealtimeAsrHandlers = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: Error) => void;
  onStarted?: () => void;
  onStopped?: () => void;
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
  private targetWord?: string;
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

  constructor(handlers: RealtimeAsrHandlers, targetWord?: string) {
    this.handlers = handlers;
    this.targetWord = targetWord;
  }

  get transcript() {
    return this.lastText;
  }

  get lemma() {
    return extractLemmaFromTranscript(this.lastText, this.targetWord);
  }

  async start() {
    if (this.running) return;
    const tokenRes = await fetch("/api/speech/nls-token", { method: "POST" });
    const cred = (await tokenRes.json()) as TokenPayload & { error?: string };
    if (!tokenRes.ok) {
      throw new Error(cred.error || "获取语音 Token 失败");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.running = true;

    if (cred.mock || cred.provider === "mock") {
      await this.startMock();
      return;
    }

    if (!cred.token || !cred.appkey || !cred.wsUrl) {
      throw new Error("实时识别凭证不完整");
    }
    this.appkey = cred.appkey;
    await this.startAliyun(cred.token, cred.appkey, cred.wsUrl);
  }

  private async startMock() {
    this.handlers.onStarted?.();
    const target = (this.targetWord || "hello").toLowerCase();
    let i = 0;
    this.mockTimer = setInterval(() => {
      i += 1;
      const partial = target.slice(0, Math.min(target.length, Math.ceil(i / 2)));
      this.lastText = partial;
      this.handlers.onPartial?.(partial);
      if (partial === target) {
        this.handlers.onFinal?.(target);
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
        } else if (name === "TranscriptionResultChanged" || name === "SentenceEnd") {
          const text = msg.payload?.result || "";
          this.lastText = text;
          this.handlers.onPartial?.(text);
          if (name === "SentenceEnd") this.handlers.onFinal?.(text);
        } else if (name === "TranscriptionCompleted") {
          if (msg.payload?.result) {
            this.lastText = msg.payload.result;
            this.handlers.onFinal?.(msg.payload.result);
          }
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
