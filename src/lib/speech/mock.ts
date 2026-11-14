import type { AsrProvider, AsrResult, TtsProvider, TtsResult } from "./types";

/**
 * 开发用 mock：不调用云厂商。
 * ASR：若传入 hint（目标词），则「听成」该词；否则返回固定占位文本。
 */
export class MockAsrProvider implements AsrProvider {
  name = "mock-asr";

  async recognize(
    _audio: Buffer,
    opts?: { language?: string; hint?: string },
  ): Promise<AsrResult> {
    const text = opts?.hint?.trim() || "hello";
    return {
      text,
      confidence: 0.92,
      alternatives: [text],
      provider: this.name,
      mock: true,
    };
  }
}

export class MockTtsProvider implements TtsProvider {
  name = "mock-tts";

  async synthesize(text: string): Promise<TtsResult> {
    return {
      spokenText: text,
      provider: this.name,
      mock: true,
      // 无真实音频；仅 SPEECH_PROVIDER=mock 时前端可用浏览器 SpeechSynthesis 顶替
    };
  }
}
