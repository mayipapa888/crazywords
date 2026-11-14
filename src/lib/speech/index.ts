import { AliyunAsrProvider, AliyunTtsProvider } from "./aliyun";
import { getSpeechProviderName } from "./config";
import { MockAsrProvider, MockTtsProvider } from "./mock";
import type { AsrProvider, TtsProvider } from "./types";

export type { AsrResult, TtsResult, AsrProvider, TtsProvider } from "./types";
export {
  getSpeechProviderName,
  speechStatusSnapshot,
  hasAsrKeys,
  hasTtsKeys,
  requireSpeechKeys,
  nlsRegion,
  nlsWsUrl,
} from "./config";

export function getAsrProvider(): AsrProvider {
  const provider = getSpeechProviderName();
  if (provider === "aliyun") return new AliyunAsrProvider();
  return new MockAsrProvider();
}

export function getTtsProvider(): TtsProvider {
  const provider = getSpeechProviderName();
  if (provider === "aliyun") return new AliyunTtsProvider();
  return new MockTtsProvider();
}
