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

/** 转写/目标词 → 规范化 token 列表（小写、去标点） */
function tokenize(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s'-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 发音判定：ASR 转写 vs 目标词（忽略大小写）。
 * - 单词：转写首个 token 与目标词一致即算对（ASR 常带多余词）；
 * - 多词短语（如 leave out）：目标词的各 token 需在转写中**按顺序**出现，
 *   允许中间夹入其它词（"leave it out" 也算对），避免多词短语被误判。
 */
export function checkPronunciation(transcript: string | null | undefined, targetWord: string): boolean {
  if (!transcript?.trim()) return false;
  const said = tokenize(transcript);
  const target = tokenize(targetWord);
  if (target.length === 0 || said.length === 0) return false;
  if (target.length === 1) return said[0] === target[0];

  let cursor = 0;
  for (const token of said) {
    if (token === target[cursor]) {
      cursor += 1;
      if (cursor === target.length) return true;
    }
  }
  return false;
}
