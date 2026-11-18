import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { parseWordCsv } from "@/lib/csv-import";
import { prisma } from "@/lib/db";
import { parseWordExcel } from "@/lib/excel-import";
import { assertByteLimit, MAX_CSV_BYTES, MAX_JSON_BODY_BYTES } from "@/lib/limits";
import { upsertEntriesForUser } from "@/lib/word-upsert";

const DEFAULT_LIST_NAME = "导入词表";
const MAX_LIST_NAME_LENGTH = 80;

function isExcelName(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".xlsx") || n.endsWith(".xls");
}

/** 上传文件名 → 默认词库名：去掉目录与最后一个扩展名 */
function listNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim().slice(0, MAX_LIST_NAME_LENGTH);
}

/** 同名文件重复导入时复用同名词库（取最早创建的同名库） */
async function findListIdByName(userId: string, name: string): Promise<string | undefined> {
  const existing = await prisma.wordList.findFirst({
    where: { userId, name },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return existing?.id;
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const contentType = req.headers.get("content-type") || "";

    /** 显式传入的词库名（为空则回落到文件名） */
    let explicitName: string | null = null;
    let uploadedFileName = "";
    let listId: string | undefined;
    let entries: Awaited<ReturnType<typeof parseWordCsv>>["entries"] = [];
    let errors: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const rawName = form.get("listName");
      explicitName = typeof rawName === "string" ? rawName.trim() : null;
      listId = form.get("listId") ? String(form.get("listId")) : undefined;
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: "请上传 CSV 或 Excel 文件" }, { status: 400 });
      }
      uploadedFileName = file.name;
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
      explicitName = body.listName?.trim() || null;
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

    // 词库名：显式传入优先；否则取上传文件名（去扩展名）；最后才用默认名。
    const listName = (
      explicitName ||
      listNameFromFile(uploadedFileName) ||
      DEFAULT_LIST_NAME
    ).slice(0, MAX_LIST_NAME_LENGTH);

    // 未指定 listId 时按名字复用已有词库，避免同文件重复导入产生一堆同名库。
    if (!listId) {
      listId = await findListIdByName(auth.user.id, listName);
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
