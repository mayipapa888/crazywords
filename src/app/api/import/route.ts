import { NextResponse } from "next/server";
import { parseWordCsv } from "@/lib/csv-import";
import { prisma } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/user";

export async function POST(req: Request) {
  const user = await getOrCreateDemoUser();
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
    csvText = await file.text();
  } else {
    const body = await req.json();
    csvText = body.csv || "";
    listName = body.listName || listName;
    listId = body.listId;
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: "CSV 为空" }, { status: 400 });
  }

  const { entries, errors } = parseWordCsv(csvText);
  if (entries.length === 0) {
    return NextResponse.json({ error: "未解析到词条", errors }, { status: 400 });
  }

  let list = listId
    ? await prisma.wordList.findFirst({ where: { id: listId, userId: user.id } })
    : null;

  if (!list) {
    list = await prisma.wordList.create({
      data: { userId: user.id, name: listName, source: "import" },
    });
  }

  let created = 0;
  let updated = 0;

  for (const row of entries) {
    const existing = await prisma.wordEntry.findUnique({
      where: { listId_word: { listId: list.id, word: row.word } },
    });

    if (existing) {
      // 覆盖：整条内容字段替换；保留 CardState / 错词本关联
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
        data: { userId: user.id, entryId: entry.id, status: "new" },
      });
      created += 1;
    }
  }

  return NextResponse.json({
    listId: list.id,
    listName: list.name,
    created,
    updated,
    total: entries.length,
    errors,
  });
}
