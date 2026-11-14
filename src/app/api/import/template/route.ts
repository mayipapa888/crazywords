import { buildImportTemplateBuffer } from "@/lib/excel-import";

export async function GET() {
  const buf = buildImportTemplateBuffer();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="words-import.xlsx"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
