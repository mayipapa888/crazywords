/** 从实时识别文本中提取可能的英文拼写（lemma） */
export function extractLemmaFromTranscript(transcript: string, targetWord?: string): string {
  const raw = (transcript || "").trim();
  if (!raw) return "";

  const tokens = raw
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => /^[a-z][a-z'-]*$/i.test(t));

  if (tokens.length === 0) return "";

  if (targetWord) {
    const target = targetWord.trim().toLowerCase();
    const hit = tokens.find((t) => t === target);
    if (hit) return hit;
    // 包含目标词的片段
    const partial = tokens.find((t) => t.includes(target) || target.includes(t));
    if (partial && Math.abs(partial.length - target.length) <= 2) return partial;
  }

  return tokens[0];
}
