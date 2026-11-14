import { toJsonArray } from "./json";
import type { ParsedEntry } from "./csv-import";

export type RowRecord = Record<string, string | number | null | undefined>;

function cell(row: RowRecord, key: string): string {
  const v = row[key] ?? row[key.toLowerCase()];
  if (v == null) return "";
  return String(v).trim();
}

function splitPipe(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 将任意表头行记录规范为词条（表头需含 word；gloss_zh/ipa/pos/example/phrases/related 可选） */
export function rowsToEntries(rows: RowRecord[]): { entries: ParsedEntry[]; errors: string[] } {
  const errors: string[] = [];
  const entries: ParsedEntry[] = [];
  const seen = new Set<string>();

  for (const [i, row] of rows.entries()) {
    const normalized: RowRecord = {};
    for (const [k, v] of Object.entries(row)) {
      normalized[k.trim().toLowerCase()] = v;
    }
    const word = cell(normalized, "word");
    if (!word) {
      errors.push(`第 ${i + 2} 行缺少 word`);
      continue;
    }
    const key = word.toLowerCase();
    if (seen.has(key)) {
      const idx = entries.findIndex((e) => e.word.toLowerCase() === key);
      if (idx >= 0) entries.splice(idx, 1);
    }
    seen.add(key);
    entries.push({
      word,
      glossZh: cell(normalized, "gloss_zh") || null,
      ipa: cell(normalized, "ipa") || null,
      pos: cell(normalized, "pos") || null,
      example: cell(normalized, "example") || null,
      phrases: toJsonArray(splitPipe(cell(normalized, "phrases"))),
      related: toJsonArray(splitPipe(cell(normalized, "related"))),
    });
  }

  return { entries, errors };
}
