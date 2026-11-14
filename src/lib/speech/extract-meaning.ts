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

/** 虚词/高频无义词，分词后不参与判定 */
const STOP_WORDS = new Set([
  "的",
  "了",
  "着",
  "是",
  "在",
  "和",
  "与",
  "及",
  "或",
  "一个",
  "一种",
  "这个",
  "那个",
  "某个",
  "什么",
  "之",
  "其",
  "地",
  "得",
  "把",
  "被",
  "使",
  "让",
  "很",
  "更",
  "最",
  "也",
  "都",
  "就",
  "而",
  "表示",
  "指",
  "即",
  "通常",
  "一般",
  "某人",
  "某物",
  "事物",
]);

function isUsefulToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (!/^[\u4e00-\u9fff]+$/.test(t)) return false;
  if (STOP_WORDS.has(t)) return false;
  return t.length >= 1;
}

type SegmenterCtor = new (
  locale?: string,
  options?: { granularity?: "word" | "grapheme" | "sentence" },
) => { segment: (input: string) => Iterable<{ segment: string }> };

/**
 * 中文智能分词。
 * 优先用 Intl.Segmenter（Node 20+/现代浏览器自带 ICU 词典，能分出「放弃」「遗弃」这类词），
 * 不可用时退化为相邻两字滑动切分，保证任何环境都有结果。
 */
export function segmentChinese(text: string): string[] {
  const cleaned = (text || "").replace(/[^\u4e00-\u9fff]/g, "");
  if (!cleaned) return [];

  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (Segmenter) {
    try {
      const segmenter = new Segmenter("zh-CN", { granularity: "word" });
      const words: string[] = [];
      for (const part of segmenter.segment(cleaned)) {
        const token = part.segment.trim();
        if (isUsefulToken(token)) words.push(token);
      }
      if (words.length > 0) return words;
    } catch {
      // 落到下面的退化实现
    }
  }

  // 退化：连续两字切片（对「放弃」这类双字词足够）
  const fallback: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    const bigram = cleaned.slice(i, i + 2);
    if (!STOP_WORDS.has(bigram)) fallback.push(bigram);
  }
  return fallback.length > 0 ? fallback : [cleaned];
}

/**
 * 口述释义判定（词粒度）：
 * 把用户说的中文和每个义项都分词，命中任一义项的关键词即算对。
 * 保留原包含关系兜底，避免分词把长词切碎后误判。
 */
export function checkMeaning(
  transcript: string | null | undefined,
  glossZh: string | null | undefined,
): boolean {
  if (!transcript?.trim() || !glossZh?.trim()) return false;
  const spokenRaw = extractChineseFromTranscript(transcript);
  if (!spokenRaw) return false;

  const spokenTokens = segmentChinese(spokenRaw);
  const spokenJoined = spokenRaw;

  const senses = glossSenses(glossZh);
  if (senses.length === 0) {
    const target = glossZh.replace(/[^\u4e00-\u9fff]/g, "");
    return target.length > 0 && (spokenJoined.includes(target) || target.includes(spokenJoined));
  }

  return senses.some((sense) => {
    // 整义项直接包含（最可靠）
    if (sense.length <= 1) return spokenJoined.includes(sense);
    if (spokenJoined.includes(sense) || sense.includes(spokenJoined)) return true;

    // 词粒度：任一词项关键词命中即算对
    const senseTokens = segmentChinese(sense).filter((t) => t.length >= 2);
    if (senseTokens.length === 0) return false;
    return senseTokens.some(
      (token) => spokenTokens.includes(token) || spokenJoined.includes(token),
    );
  });
}
