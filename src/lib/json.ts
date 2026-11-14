export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    // fallthrough
  }
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function toJsonArray(items: string[]): string {
  return JSON.stringify(items.filter(Boolean));
}

export function entryCompleteness(entry: {
  glossZh: string | null;
  example: string | null;
}): { incomplete: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!entry.glossZh?.trim()) reasons.push("缺中文释义");
  if (!entry.example?.trim()) reasons.push("缺例句");
  // 听写双模式均依赖中文释义；无释义视为不完整
  const incomplete = !entry.glossZh?.trim();
  return { incomplete, reasons };
}

/**
 * 可听写：需有中文释义。
 * clozeEnabled 字段沿用为「启用模式 B（报单词说中文）」；两模式都要求 gloss_zh。
 */
export function canDictate(
  entry: { glossZh: string | null; example: string | null },
  meaningModeEnabled?: boolean,
): boolean {
  void meaningModeEnabled;
  return Boolean(entry.glossZh?.trim());
}
