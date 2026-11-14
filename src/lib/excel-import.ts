import * as XLSX from "xlsx";
import { IMPORT_COLUMN_LABELS, positionalRowsToEntries } from "./table-import";
import type { ParsedEntry } from "./csv-import";

export const IMPORT_HEADERS = IMPORT_COLUMN_LABELS;

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
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (rows.length === 0) {
    return { entries: [], errors: ["Excel 无数据行（请保留表头）"] };
  }
  return positionalRowsToEntries(rows);
}

/** 生成导入模板（中文表头 + 样例；含序号列） */
export function buildImportTemplateBuffer(): Buffer {
  const header = [...IMPORT_COLUMN_LABELS];
  const samples = [
    header,
    [
      1,
      "abandon",
      "/əˈbændən/",
      "v.",
      "放弃；遗弃",
      "They had to abandon the project.",
      "abandon hope",
      "desert|forsake",
      "keep",
    ],
    [
      2,
      "benefit",
      "/ˈbenɪfɪt/",
      "n./v.",
      "益处；使受益",
      "Exercise can benefit your health.",
      "benefit from",
      "advantage",
      "harm",
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(samples);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "words");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
