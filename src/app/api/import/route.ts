import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { parseWordCsv } from "@/lib/csv-import";
import { prisma } from "@/lib/db";
import { assertByteLimit, MAX_CSV_BYTES, MAX_JSON_BODY_BYTES } from "@/lib/limits";

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const contentType = req.headers.get("content-type") || "";

    let csvText = "";
    let listName = "导入词表";
    let listId: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      listName = String(form.get("listName") || listName);
      listId = form.get("listId") ? String(form.get("listId")) : undefined;
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: "请上传 CSV 文件" }, { status: 400 });
      }
      assertByteLimit(file.size, MAX_CSV_BYTES, "CSV 文件");
      csvText = await file.text();
      assertByteLimit(Buffer.byteLength(csvText, "utf8"), MAX_CSV_BYTES, "CSV 内容");
    } else {
      const raw = await req.text();
      assertByteLimit(Buffer.byteLength(raw, "utf8"), MAX_JSON_BODY_BYTES, "请求体");
      const body = JSON.parse(raw) as { csv?: string; listName?: string; listId?: string };
      csvText = body.csv || "";
      listName = body.listName || listName;
      listId = body.listId;
      assertByteLimit(Buffer.byteLength(csvText, "utf8"), MAX_CSV_BYTES, "CSV 内容");
    }

    if (!csvText.trim()) {
      return NextResponse.json({ error: "CSV 为空" }, { status: 400 });
    }

    const { entries, errors } = parseWordCsv(csvText);
    if (entries.length === 0) {
      return NextResponse.json({ error: "未解析到词条", errors }, { status: 400 });
    }

    let list = listId
      ? await prisma.wordList.findFirst({ where: { id: listId, userId: auth.user.id } })
      : null;

    if (!list) {
      list = await prisma.wordList.create({
        data: { userId: auth.user.id, name: listName, source: "import" },
      });
    }

    let created = 0;
    let updated = 0;

    for (const row of entries) {
      const existing = await prisma.wordEntry.findUnique({
        where: { listId_word: { listId: list.id, word: row.word } },
      });

      if (existing) {
        await prisma.wordEntry.update({
          where: { id: existing.id },
          data: {
            glossZh: row.glossZh,
            ipa: row.ipa,
            pos: row.pos,
            example: row.example,
            phrases: row.phrases,
            related: row.related,
          },
        });
        updated += 1;
      } else {
        const entry = await prisma.wordEntry.create({
          data: { listId: list.id, ...row },
        });
        await prisma.cardState.create({
          data: { userId: auth.user.id, entryId: entry.id, status: "new" },
        });
        created += 1;
      }
    }

    return jsonWithSession(
      {
        listId: list.id,
        listName: list.name,
        created,
        updated,
        total: entries.length,
        errors,
      },
      auth,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "导入失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
