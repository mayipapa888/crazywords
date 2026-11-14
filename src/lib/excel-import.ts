import * as XLSX from "xlsx";
import { rowsToEntries, type RowRecord } from "./table-import";
import type { ParsedEntry } from "./csv-import";

export const IMPORT_HEADERS = [
  "word",
  "gloss_zh",
  "ipa",
  "pos",
  "example",
  "phrases",
  "related",
] as const;

export function parseWordExcel(buffer: Buffer): { entries: ParsedEntry[]; errors: string[] } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch (e) {
    return {
      entries: [],
      errors: [`无法解析 Excel：${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { entries: [], errors: ["Excel 无工作表"] };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet, {
    defval: "",
    raw: false,
  });
  if (rows.length === 0) {
    return { entries: [], errors: ["Excel 无数据行（请保留表头）"] };
  }
  return rowsToEntries(rows);
}

/** 生成导入模板（表头 + 样例行） */
export function buildImportTemplateBuffer(): Buffer {
  const samples = [
    {
      word: "abandon",
      gloss_zh: "放弃；遗弃",
      ipa: "/əˈbændən/",
      pos: "v.",
      example: "They had to abandon the project.",
      phrases: "abandon hope",
      related: "desert|forsake",
    },
    {
      word: "benefit",
      gloss_zh: "益处；使受益",
      ipa: "/ˈbenɪfɪt/",
      pos: "n./v.",
      example: "Exercise can benefit your health.",
      phrases: "benefit from",
      related: "advantage",
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(samples, { header: [...IMPORT_HEADERS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "words");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
