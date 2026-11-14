/** 从识别文本中提取中文片段（释义口述用） */
export function extractChineseFromTranscript(transcript: string): string {
  const raw = (transcript || "").trim();
  if (!raw) return "";

  const chunks = raw.match(/[\u4e00-\u9fff]+(?:[·．.、，,][\u4e00-\u9fff]+)*/g);
  if (chunks && chunks.length > 0) {
    return chunks.join("");
  }
  // 整段可能已是中文夹杂标点
  const stripped = raw.replace(/[^\u4e00-\u9fff·．.、，,\s]/g, "").replace(/\s+/g, "");
  return stripped;
}

/** 将中文释义拆成可比对义项 */
export function glossSenses(glossZh: string): string[] {
  return glossZh
    .split(/[;；|/／\n]+/)
    .map((s) => s.replace(/^[a-z]+\.\s*/i, "").trim())
    .map((s) => s.replace(/[^\u4e00-\u9fff]/g, ""))
    .filter((s) => s.length >= 1);
}

/**
 * 口述释义判定：识别文本中的中文是否命中词条 gloss_zh 的任一义项
 * （包含关系：说了「放弃」可对「放弃；遗弃」）
 */
export function checkMeaning(
  transcript: string | null | undefined,
  glossZh: string | null | undefined,
): boolean {
  if (!transcript?.trim() || !glossZh?.trim()) return false;
  const spoken = extractChineseFromTranscript(transcript);
  if (!spoken) return false;

  const senses = glossSenses(glossZh);
  if (senses.length === 0) {
    const target = glossZh.replace(/[^\u4e00-\u9fff]/g, "");
    return target.length > 0 && (spoken.includes(target) || target.includes(spoken));
  }

  return senses.some((sense) => {
    if (sense.length <= 1) return spoken.includes(sense);
    return spoken.includes(sense) || sense.includes(spoken);
  });
}
