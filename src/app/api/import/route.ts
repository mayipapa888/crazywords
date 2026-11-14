import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { parseWordCsv } from "@/lib/csv-import";
import { parseWordExcel } from "@/lib/excel-import";
import { assertByteLimit, MAX_CSV_BYTES, MAX_JSON_BODY_BYTES } from "@/lib/limits";
import { upsertEntriesForUser } from "@/lib/word-upsert";

function isExcelName(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".xlsx") || n.endsWith(".xls");
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const contentType = req.headers.get("content-type") || "";

    let listName = "导入词表";
    let listId: string | undefined;
    let entries: Awaited<ReturnType<typeof parseWordCsv>>["entries"] = [];
    let errors: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      listName = String(form.get("listName") || listName);
      listId = form.get("listId") ? String(form.get("listId")) : undefined;
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: "请上传 CSV 或 Excel 文件" }, { status: 400 });
      }
      assertByteLimit(file.size, MAX_CSV_BYTES, "导入文件");
      const buf = Buffer.from(await file.arrayBuffer());
      if (isExcelName(file.name) || file.type.includes("spreadsheet") || file.type.includes("excel")) {
        ({ entries, errors } = parseWordExcel(buf));
      } else {
        const csvText = buf.toString("utf8");
        assertByteLimit(Buffer.byteLength(csvText, "utf8"), MAX_CSV_BYTES, "CSV 内容");
        ({ entries, errors } = parseWordCsv(csvText));
      }
    } else {
      const raw = await req.text();
      assertByteLimit(Buffer.byteLength(raw, "utf8"), MAX_JSON_BODY_BYTES, "请求体");
      const body = JSON.parse(raw) as { csv?: string; listName?: string; listId?: string };
      listName = body.listName || listName;
      listId = body.listId;
      const csvText = body.csv || "";
      assertByteLimit(Buffer.byteLength(csvText, "utf8"), MAX_CSV_BYTES, "CSV 内容");
      if (!csvText.trim()) {
        return NextResponse.json({ error: "CSV 为空" }, { status: 400 });
      }
      ({ entries, errors } = parseWordCsv(csvText));
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: "未解析到词条", errors }, { status: 400 });
    }

    const result = await upsertEntriesForUser({
      userId: auth.user.id,
      listId,
      listName,
      source: "import",
      entries,
    });

    return jsonWithSession({ ...result, errors }, auth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "导入失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
