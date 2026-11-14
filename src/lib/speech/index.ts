import { AliyunAsrProvider, AliyunTtsProvider } from "./aliyun";
import { MockAsrProvider, MockTtsProvider } from "./mock";
import type { AsrProvider, TtsProvider } from "./types";

export type { AsrResult, TtsResult, AsrProvider, TtsProvider } from "./types";

export function getAsrProvider(): AsrProvider {
  const provider = (process.env.SPEECH_PROVIDER || "mock").toLowerCase();
  if (provider === "aliyun") return new AliyunAsrProvider();
  if (provider === "stub" || provider === "aliyun-stub") {
    throw new Error(
      "SPEECH_PROVIDER=stub 已移除。请使用 aliyun（真实调用）或 mock（本地开发）。",
    );
  }
  return new MockAsrProvider();
}

export function getTtsProvider(): TtsProvider {
  const provider = (process.env.SPEECH_PROVIDER || "mock").toLowerCase();
  if (provider === "aliyun") return new AliyunTtsProvider();
  if (provider === "stub" || provider === "aliyun-stub") {
    throw new Error(
      "SPEECH_PROVIDER=stub 已移除。请使用 aliyun（真实调用）或 mock（本地开发）。",
    );
  }
  return new MockTtsProvider();
}
