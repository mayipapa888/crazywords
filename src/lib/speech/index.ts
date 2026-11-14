import { AliyunAsrStub, AliyunTtsStub } from "./aliyun-stub";
import { MockAsrProvider, MockTtsProvider } from "./mock";
import type { AsrProvider, TtsProvider } from "./types";

export type { AsrResult, TtsResult, AsrProvider, TtsProvider } from "./types";

export function getAsrProvider(): AsrProvider {
  const provider = (process.env.SPEECH_PROVIDER || "mock").toLowerCase();
  if (provider === "aliyun") return new AliyunAsrStub();
  return new MockAsrProvider();
}

export function getTtsProvider(): TtsProvider {
  const provider = (process.env.SPEECH_PROVIDER || "mock").toLowerCase();
  if (provider === "aliyun") return new AliyunTtsStub();
  return new MockTtsProvider();
}
