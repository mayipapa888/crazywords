import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray, toJsonArray } from "@/lib/json";

/** 查词结果加入错词本时固定写入的词表名 */
const LOOKUP_LIST_NAME = "查词生词";

/** 可选文本字段：缺省 / 空串返回 undefined（更新时保留旧值，新建时用默认 null）。 */
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function stringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split("|");
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const items = await prisma.wrongBookItem.findMany({
      where: { userId: auth.user.id, active: true },
      include: { entry: true },
      orderBy: { lastWrongAt: "desc" },
    });

    return jsonWithSession(
      {
        items: items.map((w) => ({
          id: w.id,
          wrongCount: w.wrongCount,
          lastWrongAt: w.lastWrongAt,
          lastWrongKinds: w.lastWrongKinds,
          consecutiveOk: w.consecutiveOk,
          entry: {
            id: w.entry.id,
            word: w.entry.word,
            glossZh: w.entry.glossZh,
            ipa: w.entry.ipa,
            pos: w.entry.pos,
            example: w.entry.example,
            phrases: parseStringArray(w.entry.phrases),
            related: parseStringArray(w.entry.related),
          },
        })),
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}

/**
 * 查词结果加入错词本：写入（或复用）「查词生词」词表 + WordEntry + WrongBookItem。
 * 同一个词可重复加入：wrongCount 累加、lastWrongAt 刷新、重新激活。
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const raw = await req.json();
    const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const word = String(body.word ?? "").trim();
    if (!word) {
      return NextResponse.json({ error: "单词（word）必填" }, { status: 400 });
    }

    // 1. 定位（或创建）用户固定的查词生词表
    let list = await prisma.wordList.findFirst({
      where: { userId: auth.user.id, name: LOOKUP_LIST_NAME },
      orderBy: { createdAt: "asc" },
    });
    if (!list) {
      list = await prisma.wordList.create({
        data: { userId: auth.user.id, name: LOOKUP_LIST_NAME, source: "manual" },
      });
    }

    // 2. 按 word upsert 词条（phrases / related 以 JSON 字符串存储）
    const phrases =
      body.phrases === undefined ? undefined : toJsonArray(stringList(body.phrases));
    const related =
      body.related === undefined ? undefined : toJsonArray(stringList(body.related));
    const entryData = {
      glossZh: optionalText(body.glossZh),
      ipa: optionalText(body.ipa),
      pos: optionalText(body.pos),
      example: optionalText(body.example),
      phrases,
      related,
    };

    const entry = await prisma.wordEntry.upsert({
      where: { listId_word: { listId: list.id, word } },
      create: { listId: list.id, word, ...entryData },
      update: entryData,
    });

    // 3. upsert 错词本条目：手动加入视为一次错误
    const wrong = await prisma.wrongBookItem.upsert({
      where: { userId_entryId: { userId: auth.user.id, entryId: entry.id } },
      create: {
        userId: auth.user.id,
        entryId: entry.id,
        wrongCount: 1,
        lastWrongKinds: "both",
        active: true,
        consecutiveOk: 0,
      },
      update: {
        wrongCount: { increment: 1 },
        lastWrongAt: new Date(),
        active: true,
        consecutiveOk: 0,
      },
    });

    return jsonWithSession(
      { ok: true, entryId: entry.id, wrongBookId: wrong.id },
      auth,
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "加入错词本失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
