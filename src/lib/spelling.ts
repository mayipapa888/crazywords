/**
 * 全角 → 半角归一：
 * - 全角 ASCII（\uFF01-\uFF5E，含全角字母、数字、标点、全角连接号 －）→ 半角（码位减 0xFEE0）；
 * - 全角空格 \u3000 → 普通空格；
 * - 中文引号 “”‘’ → 半角 " / '；
 * 其余字符（中文、emoji 等）原样保留。
 */
export function toHalfWidth(input: string): string {
  if (!input) return input;
  return input
    .replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

/** 拼写判定：忽略大小写、trim、去目标无标点时的用户标点；单词目标还会合并中间空格。 */
export function normalizeSpelling(input: string, target: string): string {
  const s = toHalfWidth(input).trim();
  const normalizedTarget = toHalfWidth(target).trim();
  const targetHasPunct = /[^\w\s'-]/.test(normalizedTarget);
  const base = targetHasPunct
    ? s.toLowerCase()
    : s.replace(/[^\w\s'-]/g, "").toLowerCase();
  // 目标词是单个词时，把识别结果里字母之间的空格去掉（a p p l e → apple）。
  if (!/\s/.test(normalizedTarget)) {
    return base.replace(/\s+/g, "");
  }
  return base;
}

export function checkSpelling(input: string, targetWord: string): boolean {
  // 目标词也走同一套归一（全角目标词也能正确比对）
  const target = normalizeSpelling(targetWord, targetWord);
  return normalizeSpelling(input, targetWord) === target;
}

/** 转写/目标词 → 规范化 token 列表（全角转半角、小写、去标点） */
function tokenize(text: string): string[] {
  return toHalfWidth(text)
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
  if (target.length === 1) {
    if (said[0] === target[0]) return true;
    // 逐字母念（a p p l e）时把单字母 token 拼起来再比
    if (said.length >= 2 && said.every((token) => /^[a-z]$/i.test(token))) {
      return said.join("") === target[0];
    }
    return false;
  }

  let cursor = 0;
  for (const token of said) {
    if (token === target[cursor]) {
      cursor += 1;
      if (cursor === target.length) return true;
    }
  }
  return false;
}
