import Papa from "papaparse";
import { positionalRowsToEntries } from "./table-import";

export type ParsedEntry = {
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string;
  related: string;
};

/**
 * CSV：固定列序
 * 序号,单词,音标,词性,中文释义,例句,相关词组,近义词,反义词
 * 首行表头不导入；首列序号不导入。
 */
export function parseWordCsv(text: string): { entries: ParsedEntry[]; errors: string[] } {
  const parsed = Papa.parse<(string | null)[]>(text, {
    header: false,
    skipEmptyLines: true,
  });

  const errors: string[] = [...(parsed.errors || []).map((e) => e.message)];
  const rows = (parsed.data || []).map((r) => (Array.isArray(r) ? r : []));
  if (rows.length === 0) {
    return { entries: [], errors: [...errors, "CSV 为空"] };
  }

  const { entries, errors: rowErrors } = positionalRowsToEntries(rows);
  return { entries, errors: [...errors, ...rowErrors] };
}
