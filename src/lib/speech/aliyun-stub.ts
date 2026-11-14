import type { AsrProvider, AsrResult, TtsProvider, TtsResult } from "./types";

/**
 * 国内厂商（阿里云）占位实现：读取环境变量，未配置密钥时抛出明确错误。
 * 真实 HTTP 调用留待接入密钥后实现。
 */
function requireKeys(kind: "ASR" | "TTS") {
  const id = process.env[`${kind}_ACCESS_KEY_ID`];
  const secret = process.env[`${kind}_ACCESS_KEY_SECRET`];
  const appKey = process.env[`${kind}_APP_KEY`];
  if (!id || !secret || !appKey) {
    throw new Error(
      `${kind} 密钥未配置。请在 .env 设置 ${kind}_ACCESS_KEY_ID / ${kind}_ACCESS_KEY_SECRET / ${kind}_APP_KEY，或将 SPEECH_PROVIDER=mock`,
    );
  }
  return { id, secret, appKey };
}

export class AliyunAsrStub implements AsrProvider {
  name = "aliyun-asr-stub";

  async recognize(_audio: Buffer, opts?: { hint?: string }): Promise<AsrResult> {
    requireKeys("ASR");
    // 占位：密钥存在时仍未接真 API，返回 hint 以便联调 UI
    const text = opts?.hint?.trim() || "";
    return {
      text,
      confidence: 0,
      provider: this.name,
      mock: true,
    };
  }
}

export class AliyunTtsStub implements TtsProvider {
  name = "aliyun-tts-stub";

  async synthesize(text: string): Promise<TtsResult> {
    requireKeys("TTS");
    return {
      spokenText: text,
      provider: this.name,
      mock: true,
    };
  }
}
