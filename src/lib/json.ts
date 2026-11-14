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
  // 两缺才算不可听写；仅缺其一仍可走另一模式
  const incomplete = !entry.glossZh?.trim() && !entry.example?.trim();
  return { incomplete, reasons };
}

export function canDictate(
  entry: { glossZh: string | null; example: string | null },
  clozeEnabled: boolean,
): boolean {
  if (entry.glossZh?.trim()) return true;
  if (clozeEnabled && entry.example?.trim()) return true;
  return false;
}
