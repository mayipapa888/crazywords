export type SpeechProviderName = "mock" | "aliyun";

export type SpeechKeys = {
  accessKeyId: string;
  accessKeySecret: string;
  appKey: string;
  /** 实际取自 ASR_* 还是 TTS_* */
  source: "ASR" | "TTS";
};

/** 解析 SPEECH_PROVIDER；未知值抛错，禁止静默当 mock。 */
export function getSpeechProviderName(): SpeechProviderName {
  const raw = (process.env.SPEECH_PROVIDER || "mock").trim().toLowerCase();
  if (raw === "aliyun") return "aliyun";
  if (raw === "mock" || raw === "") return "mock";
  if (raw === "stub" || raw === "aliyun-stub") {
    throw new Error(
      "SPEECH_PROVIDER=stub 已移除。请使用 aliyun（真实调用）或 mock（仅本地开发）。",
    );
  }
  throw new Error(
    `未知 SPEECH_PROVIDER="${raw}"。仅支持 mock | aliyun；生产请设 SPEECH_PROVIDER=aliyun。`,
  );
}

export function nlsRegion(): string {
  return (process.env.NLS_REGION || "cn-shanghai").trim() || "cn-shanghai";
}

export function nlsWsUrl(): string {
  const region = nlsRegion();
  return (
    process.env.NLS_WS_URL?.trim() ||
    `wss://nls-gateway-${region}.aliyuncs.com/ws/v1`
  );
}

/** 读取整数型 env：缺失/非法回退默认值，并夹到 [min, max]。 */
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 读取布尔型 env：1/true/yes/on 与 0/false/no/off，其余回退默认值。 */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function envString(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw || undefined;
}

export type TtsFormat = "mp3" | "wav" | "pcm";

export type TtsSettings = {
  voice: string;
  format: TtsFormat;
  sampleRate: number;
  /** -500~500；官方公式：小于 1 倍速时 rate = (1 - 1/倍数) / 0.002 */
  speechRate: number;
  pitchRate: number;
  volume: number;
  timeoutMs: number;
};

const TTS_FORMATS: TtsFormat[] = ["mp3", "wav", "pcm"];
const TTS_SAMPLE_RATES = [8000, 16000, 24000, 48000];

/**
 * 语音合成参数，全部可用 env 覆盖且带安全默认：
 * - 英文默认 ava（美式英文女声，8K/16K），中文默认 xiaoyun；
 * - 英文默认语速 -100（约 0.83 倍速，拼写朗读更清晰），中文 0（原速）；
 * - 采样率默认 16000：短文本 TTS 的 ava/betty 仅支持 8K/16K，24K 需发音人支持。
 */
export function getTtsSettings(language?: string): TtsSettings {
  const isEn = (language || "zh-CN").trim().toLowerCase().startsWith("en");
  const voice = isEn
    ? envString("TTS_VOICE_EN") || envString("TTS_VOICE") || "ava"
    : envString("TTS_VOICE") || "xiaoyun";

  const rawFormat = (process.env.TTS_FORMAT || "mp3").trim().toLowerCase();
  const format = TTS_FORMATS.includes(rawFormat as TtsFormat)
    ? (rawFormat as TtsFormat)
    : "mp3";

  const rawSampleRate = envInt("TTS_SAMPLE_RATE", 16000, 8000, 48000);
  const sampleRate = TTS_SAMPLE_RATES.includes(rawSampleRate) ? rawSampleRate : 16000;

  return {
    voice,
    format,
    sampleRate,
    speechRate: envInt(
      isEn ? "TTS_SPEECH_RATE_EN" : "TTS_SPEECH_RATE_ZH",
      isEn ? -100 : 0,
      -500,
      500,
    ),
    pitchRate: envInt("TTS_PITCH_RATE", 0, -500, 500),
    volume: envInt("TTS_VOLUME", 50, 0, 100),
    timeoutMs: envInt("TTS_TIMEOUT_MS", 15000, 1000, 60000),
  };
}

export type AsrSessionSettings = {
  format: "pcm";
  sampleRate: 8000 | 16000;
  enableIntermediateResult: boolean;
  enablePunctuationPrediction: boolean;
  maxSentenceSilence: number;
  vocabularyId?: string;
  customizationId?: string;
};

/**
 * 实时识别 StartTranscription 参数。NLS 只支持 8k/16k PCM 16bit 单声道；
 * 语种模型在 NLS 控制台项目里选择，协议本身没有 model 参数。
 */
export function getAsrSessionSettings(): AsrSessionSettings {
  const rate = envInt("NLS_ASR_SAMPLE_RATE", 16000, 8000, 16000);
  return {
    format: "pcm",
    sampleRate: rate === 8000 ? 8000 : 16000,
    enableIntermediateResult: envBool("NLS_ASR_INTERMEDIATE_RESULT", true),
    enablePunctuationPrediction: envBool("NLS_ASR_PUNCTUATION", false),
    maxSentenceSilence: envInt("NLS_ASR_MAX_SENTENCE_SILENCE", 800, 200, 2000),
    vocabularyId: envString("NLS_ASR_VOCABULARY_ID"),
    customizationId: envString("NLS_ASR_CUSTOMIZATION_ID"),
  };
}

/** 一句话识别 REST 的超时（ms）。 */
export function getAsrTimeoutMs(): number {
  return envInt("ASR_TIMEOUT_MS", 30000, 1000, 120000);
}

function readKeyTriple(prefix: "ASR" | "TTS"): SpeechKeys | null {
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`]?.trim();
  const accessKeySecret = process.env[`${prefix}_ACCESS_KEY_SECRET`]?.trim();
  const appKey = process.env[`${prefix}_APP_KEY`]?.trim();
  if (!accessKeyId || !accessKeySecret || !appKey) return null;
  return { accessKeyId, accessKeySecret, appKey, source: prefix };
}

export function hasAsrKeys(): boolean {
  return Boolean(readKeyTriple("ASR"));
}

/** TTS 可用：填了 TTS_*，或回退到已填的 ASR_*（同一项目常见） */
export function hasTtsKeys(): boolean {
  return Boolean(readKeyTriple("TTS") || readKeyTriple("ASR"));
}

/**
 * 读取密钥。aliyun 模式下缺失则抛错，绝不静默 mock。
 * TTS 若未单独配置，允许使用 ASR_*（同账号同项目）。
 */
export function requireSpeechKeys(kind: "ASR" | "TTS"): SpeechKeys {
  if (kind === "ASR") {
    const keys = readKeyTriple("ASR");
    if (!keys) {
      throw new Error(
        "ASR 密钥未配置。请设置 ASR_ACCESS_KEY_ID、ASR_ACCESS_KEY_SECRET、ASR_APP_KEY，并开通「实时语音识别」；或将 SPEECH_PROVIDER=mock 仅用于本地开发。",
      );
    }
    return keys;
  }

  const tts = readKeyTriple("TTS");
  if (tts) return tts;
  const asr = readKeyTriple("ASR");
  if (asr) return { ...asr, source: "ASR" };

  throw new Error(
    "TTS 密钥未配置。请设置 TTS_ACCESS_KEY_ID、TTS_ACCESS_KEY_SECRET、TTS_APP_KEY（可与 ASR_* 相同），并开通「语音合成」；或将 SPEECH_PROVIDER=mock 仅用于本地开发。",
  );
}

export function speechStatusSnapshot() {
  const provider = getSpeechProviderName();
  return {
    provider,
    mock: provider === "mock",
    nlsRegion: nlsRegion(),
    nlsWsUrl: nlsWsUrl(),
    asrConfigured: hasAsrKeys(),
    ttsConfigured: hasTtsKeys(),
    ready:
      provider === "mock" ||
      (provider === "aliyun" && hasAsrKeys() && hasTtsKeys()),
    note:
      provider === "mock"
        ? "当前为 mock：不调用阿里云。生产请设 SPEECH_PROVIDER=aliyun 并配置 ASR_* / TTS_*。"
        : !hasAsrKeys() || !hasTtsKeys()
          ? "SPEECH_PROVIDER=aliyun 但密钥不完整：听写实时 ASR 需 ASR_*，播报需 TTS_*（或与 ASR_* 相同）。"
          : "已配置阿里云：实时识别走 SpeechTranscriber，播报走阿里云 TTS。",
  };
}
