export type AsrResult = {
  text: string;
  confidence: number;
  alternatives?: string[];
  provider: string;
  mock: boolean;
};

export type TtsResult = {
  /** data URL or empty when stub only logs */
  audioBase64?: string;
  mimeType?: string;
  spokenText: string;
  provider: string;
  mock: boolean;
};

export interface AsrProvider {
  name: string;
  recognize(audio: Buffer, opts?: { language?: string; hint?: string }): Promise<AsrResult>;
}

export interface TtsProvider {
  name: string;
  synthesize(text: string, opts?: { language?: string }): Promise<TtsResult>;
}
