/** 拼写判定：忽略大小写、trim、去目标无标点时的用户标点。 */
export function normalizeSpelling(input: string, target: string): string {
  let s = input.trim();
  const targetHasPunct = /[^\w\s'-]/.test(target);
  if (!targetHasPunct) {
    s = s.replace(/[^\w\s'-]/g, "");
  }
  return s.toLowerCase();
}

export function checkSpelling(input: string, targetWord: string): boolean {
  return normalizeSpelling(input, targetWord) === targetWord.trim().toLowerCase();
}

/** 发音判定：ASR 转写 vs 目标词（忽略大小写）。 */
export function checkPronunciation(transcript: string | null | undefined, targetWord: string): boolean {
  if (!transcript?.trim()) return false;
  const cleaned = transcript
    .trim()
    .toLowerCase()
    .replace(/[^\w\s'-]/g, "")
    .split(/\s+/)[0];
  return cleaned === targetWord.trim().toLowerCase();
}
