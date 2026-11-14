import { getNlsToken } from "./aliyun-token";
import { toAliyunAsrWav } from "./audio-convert";
import { nlsRegion, requireSpeechKeys } from "./config";
import type { AsrProvider, AsrResult, TtsProvider, TtsResult } from "./types";

function gatewayBase(): string {
  return `https://nls-gateway-${nlsRegion()}.aliyuncs.com`;
}

/** 一句话识别 RESTful（适合听写短录音） */
export class AliyunAsrProvider implements AsrProvider {
  name = "aliyun-asr";

  async recognize(audio: Buffer, opts?: { language?: string; hint?: string }): Promise<AsrResult> {
    void opts; // 真 ASR 不使用 hint，避免静默「听成」目标词
    const keys = requireSpeechKeys("ASR");
    const token = await getNlsToken({
      accessKeyId: keys.accessKeyId,
      accessKeySecret: keys.accessKeySecret,
      region: nlsRegion(),
    });

    const { wav, format } = await toAliyunAsrWav(audio);
    const maxBytes = Number(process.env.ASR_MAX_BYTES || 2 * 1024 * 1024);
    if (wav.length > maxBytes) {
      throw new Error(`ASR 音频过大（${wav.length} > ${maxBytes} 字节）`);
    }

    const url = new URL(`${gatewayBase()}/stream/v1/asr`);
    url.searchParams.set("appkey", keys.appKey);
    url.searchParams.set("format", format);
    url.searchParams.set("sample_rate", "16000");
    url.searchParams.set("enable_punctuation_prediction", "false");
    url.searchParams.set("enable_inverse_text_normalization", "true");

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "X-NLS-Token": token,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(wav.length),
      },
      body: new Uint8Array(wav),
    });

    const textBody = await res.text();
    let json: { status?: number; result?: string; message?: string; task_id?: string };
    try {
      json = JSON.parse(textBody);
    } catch {
      throw new Error(`阿里云 ASR 响应非 JSON（HTTP ${res.status}）：${textBody.slice(0, 200)}`);
    }

    // 成功状态码 20000000
    if (json.status !== 20000000) {
      throw new Error(
        `阿里云 ASR 失败：status=${json.status} message=${json.message || "unknown"} task_id=${json.task_id || ""}`,
      );
    }

    return {
      text: (json.result || "").trim(),
      confidence: 1,
      provider: this.name,
      mock: false,
    };
  }
}

/** 智能语音交互 · 语音合成 RESTful */
export class AliyunTtsProvider implements TtsProvider {
  name = "aliyun-tts";

  async synthesize(text: string, opts?: { language?: string }): Promise<TtsResult> {
    const keys = requireSpeechKeys("TTS");
    const clipped = text.slice(0, 300);
    if (!clipped.trim()) {
      throw new Error("TTS 文本为空");
    }

    const token = await getNlsToken({
      accessKeyId: keys.accessKeyId,
      accessKeySecret: keys.accessKeySecret,
      region: nlsRegion(),
    });

    const isEn = Boolean(opts?.language?.toLowerCase().startsWith("en"));
    const voice =
      (isEn
        ? process.env.TTS_VOICE_EN?.trim() || process.env.TTS_VOICE?.trim()
        : process.env.TTS_VOICE?.trim()) || (isEn ? "betty" : "xiaoyun");
    const format = (process.env.TTS_FORMAT || "mp3").toLowerCase();
    const sampleRate = Number(process.env.TTS_SAMPLE_RATE || 16000);

    const res = await fetch(`${gatewayBase()}/stream/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appkey: keys.appKey,
        token,
        text: clipped,
        format,
        sample_rate: sampleRate,
        voice,
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());

    if (contentType.includes("application/json") || buf[0] === 0x7b /* { */) {
      let message = buf.toString("utf8");
      try {
        const j = JSON.parse(message) as { message?: string; status?: number };
        message = `status=${j.status} ${j.message || message}`;
      } catch {
        // keep raw
      }
      throw new Error(`阿里云 TTS 失败：${message}`);
    }

    if (!res.ok) {
      throw new Error(`阿里云 TTS HTTP ${res.status}：${buf.toString("utf8").slice(0, 200)}`);
    }

    const mimeType =
      contentType.includes("mpeg") || format === "mp3"
        ? "audio/mpeg"
        : contentType.includes("wav") || format === "wav"
          ? "audio/wav"
          : contentType || "audio/mpeg";

    return {
      spokenText: clipped,
      audioBase64: buf.toString("base64"),
      mimeType,
      provider: this.name,
      mock: false,
    };
  }
}
