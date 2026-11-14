import Papa from "papaparse";
import { toJsonArray } from "./json";

export type CsvRow = {
  word: string;
  gloss_zh?: string;
  ipa?: string;
  pos?: string;
  example?: string;
  phrases?: string;
  related?: string;
};

export type ParsedEntry = {
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string;
  related: string;
};

function splitPipe(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseWordCsv(text: string): { entries: ParsedEntry[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const errors: string[] = [...(parsed.errors || []).map((e) => e.message)];
  const entries: ParsedEntry[] = [];
  const seen = new Set<string>();

  for (const [i, row] of (parsed.data || []).entries()) {
    const word = (row.word || "").trim();
    if (!word) {
      errors.push(`第 ${i + 2} 行缺少 word`);
      continue;
    }
    const key = word.toLowerCase();
    // 同文件内后行覆盖前行
    if (seen.has(key)) {
      const idx = entries.findIndex((e) => e.word.toLowerCase() === key);
      if (idx >= 0) entries.splice(idx, 1);
    }
    seen.add(key);

    entries.push({
      word,
      glossZh: row.gloss_zh?.trim() || null,
      ipa: row.ipa?.trim() || null,
      pos: row.pos?.trim() || null,
      example: row.example?.trim() || null,
      phrases: toJsonArray(splitPipe(row.phrases)),
      related: toJsonArray(splitPipe(row.related)),
    });
  }

  return { entries, errors };
}
