import { toHalfWidth } from "@/lib/spelling";

/** 把识别文本 / 目标词切成可比较的英文 token（全角转半角、小写、去标点、去首尾单引号） */
function tokenize(text: string): string[] {
  return toHalfWidth(text || "")
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => /^[a-z][a-z'-]*$/i.test(t));
}

/**
 * 多词短语匹配：按顺序在转写 token 里逐词查找，允许目标词之间夹入
 * 额外界词 / 标点（如转写「leave it out」也能命中「leave out」）。
 * 顺序对上返回 true，缺词或顺序不对返回 false。
 */
function matchesPhrase(targetTokens: string[], tokens: string[]): boolean {
  let cursor = 0;
  for (const targetToken of targetTokens) {
    let found = -1;
    for (let i = cursor; i < tokens.length; i += 1) {
      if (tokens[i] === targetToken) {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}

/** 从实时识别文本中提取可能的英文拼写（lemma） */
export function extractLemmaFromTranscript(transcript: string, targetWord?: string): string {
  const raw = (transcript || "").trim();
  if (!raw) return "";

  const tokens = tokenize(raw);
  if (tokens.length === 0) return "";

  if (targetWord) {
    const target = toHalfWidth(targetWord)
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    const targetTokens = tokenize(target);

    // 多词短语（含空格）：按顺序匹配短语的各个词，命中则返回完整短语，
    // 不能只返回第一个词，否则 checkSpelling 永远拿半截短语去比对。
    if (targetTokens.length > 1) {
      if (matchesPhrase(targetTokens, tokens)) {
        return targetWord.trim().replace(/\s+/g, " ");
      }
      // 未命中完整短语：继续走下面的单词语义兜底
    }

    const hit = tokens.find((t) => t === target);
    if (hit) return hit;
    // 包含目标词的片段
    const partial = tokens.find((t) => t.includes(target) || target.includes(t));
    if (partial && Math.abs(partial.length - target.length) <= 2) return partial;
  }

  return tokens[0];
}
