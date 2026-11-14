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
