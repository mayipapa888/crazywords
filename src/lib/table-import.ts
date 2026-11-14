import { toJsonArray } from "./json";
import type { ParsedEntry } from "./csv-import";

export type RowRecord = Record<string, string | number | null | undefined>;

/** 固定列顺序（0-based）；首列序号忽略，首行表头忽略 */
export const IMPORT_COLUMN_LABELS = [
  "序号",
  "单词",
  "音标",
  "词性",
  "中文释义",
  "例句",
  "相关词组",
  "近义词",
  "反义词",
] as const;

export const IMPORT_HEADERS_EN = [
  "seq",
  "word",
  "ipa",
  "pos",
  "gloss_zh",
  "example",
  "phrases",
  "synonyms",
  "antonyms",
] as const;

function splitPipe(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function cellAt(row: (string | number | null | undefined)[], i: number): string {
  const v = row[i];
  if (v == null) return "";
  return String(v).trim();
}

function mergeRelated(synonyms: string, antonyms: string): string[] {
  const out: string[] = [];
  for (const s of splitPipe(synonyms)) out.push(`近:${s}`);
  for (const a of splitPipe(antonyms)) out.push(`反:${a}`);
  return out;
}

/**
 * 按固定列序解析（跳过表头行 + 忽略序号列）。
 * rows 为二维表，含表头；数据从第 2 行起。
 */
export function positionalRowsToEntries(
  rows: (string | number | null | undefined)[][],
): { entries: ParsedEntry[]; errors: string[] } {
  const errors: string[] = [];
  const entries: ParsedEntry[] = [];
  const seen = new Set<string>();

  // 跳过首行表头
  const dataRows = rows.slice(1);

  for (const [i, row] of dataRows.entries()) {
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;
    const word = cellAt(row, 1); // 第 2 列：单词
    if (!word) {
      errors.push(`第 ${i + 2} 行缺少单词`);
      continue;
    }
    const key = word.toLowerCase();
    if (seen.has(key)) {
      const idx = entries.findIndex((e) => e.word.toLowerCase() === key);
      if (idx >= 0) entries.splice(idx, 1);
    }
    seen.add(key);

    const ipa = cellAt(row, 2) || null;
    const pos = cellAt(row, 3) || null;
    const glossZh = cellAt(row, 4) || null;
    const example = cellAt(row, 5) || null;
    const phrases = toJsonArray(splitPipe(cellAt(row, 6)));
    const related = toJsonArray(mergeRelated(cellAt(row, 7), cellAt(row, 8)));

    entries.push({
      word,
      glossZh,
      ipa,
      pos,
      example,
      phrases,
      related,
    });
  }

  return { entries, errors };
}

/** @deprecated 旧命名表头兼容；优先用 positionalRowsToEntries */
export function rowsToEntries(rows: RowRecord[]): { entries: ParsedEntry[]; errors: string[] } {
  const matrix: string[][] = [IMPORT_COLUMN_LABELS as unknown as string[]];
  for (const row of rows) {
    const n: RowRecord = {};
    for (const [k, v] of Object.entries(row)) {
      n[k.trim().toLowerCase()] = v;
    }
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = n[k];
        if (v != null && String(v).trim()) return String(v).trim();
      }
      return "";
    };
    matrix.push([
      get("序号", "seq", "no", "#"),
      get("单词", "word"),
      get("音标", "ipa"),
      get("词性", "pos"),
      get("中文释义", "gloss_zh", "glosszh"),
      get("例句", "example"),
      get("相关词组", "phrases", "phrase"),
      get("近义词", "synonyms", "synonym"),
      get("反义词", "antonyms", "antonym"),
    ]);
  }
  return positionalRowsToEntries(matrix);
}
