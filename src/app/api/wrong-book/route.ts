import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray, toJsonArray } from "@/lib/json";

/** 查词相关写入统一使用的词表名（与 /api/entries/manual 保持一致） */
const LOOKUP_LIST_NAME = "查词收藏";

type EntryFields = {
  glossZh?: string;
  ipa?: string;
  pos?: string;
  example?: string;
  phrases?: string;
  related?: string;
};

type OwnedEntry = {
  id: string;
  listId: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string;
  related: string;
  list: { name: string };
};

/** 可选文本字段：缺省 / 空串返回 undefined（更新时保留旧值，新建时用默认 null） */
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function stringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split("|");
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

/** 词条字段是否为空（JSON 数组 "[]" 也视为空） */
function isBlank(value: string | null | undefined): boolean {
  if (value === undefined || value === null) return true;
  const text = value.trim();
  return text === "" || text === "[]";
}

/**
 * 在当前用户任意词表里按 word 查找已有词条：
 * trim + 大小写不敏感比较；优先命中「查词收藏」，其次创建更早的词条。
 * 两条查词写入路径共用同一规则，保证拿到同一个 entryId。
 */
async function findExistingEntry(
  tx: Prisma.TransactionClient,
  userId: string,
  word: string,
): Promise<OwnedEntry | null> {
  const lists = await tx.wordList.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (lists.length === 0) return null;

  const entries = await tx.wordEntry.findMany({
    where: { listId: { in: lists.map((list) => list.id) } },
    include: { list: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const target = word.trim().toLowerCase();
  const matches = entries.filter(
    (entry) => entry.word.trim().toLowerCase() === target,
  );
  if (matches.length === 0) return null;

  const unifiedListIds = new Set(
    lists.filter((list) => list.name === LOOKUP_LIST_NAME).map((list) => list.id),
  );
  return matches.find((entry) => unifiedListIds.has(entry.listId)) ?? matches[0];
}

/** 只补齐缺失字段，已有非空值一律保留，避免覆盖用户数据 */
function buildFillData(existing: OwnedEntry, incoming: EntryFields): EntryFields {
  const data: EntryFields = {};
  const keys = ["glossZh", "ipa", "pos", "example", "phrases", "related"] as const;
  for (const key of keys) {
    const next = incoming[key];
    if (next === undefined || isBlank(next)) continue;
    if (isBlank(existing[key])) data[key] = next;
  }
  return data;
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
 * 查词结果加入错词本：
 * 先复用（或创建）「查词收藏」词表里的同一个 WordEntry，再 upsert 错词本引用。
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

    const fields: EntryFields = {
      glossZh: optionalText(body.glossZh),
      ipa: optionalText(body.ipa),
      pos: optionalText(body.pos),
      example: optionalText(body.example),
      phrases:
        body.phrases === undefined ? undefined : toJsonArray(stringList(body.phrases)),
      related:
        body.related === undefined ? undefined : toJsonArray(stringList(body.related)),
    };

    // 词条复用/创建与错词本引用放在同一事务：任一步失败都不留半条数据
    const result = await prisma.$transaction(async (tx) => {
      const existing = await findExistingEntry(tx, auth.user.id, word);
      let entryId: string;

      if (existing) {
        const fill = buildFillData(existing, fields);
        if (Object.keys(fill).length > 0) {
          await tx.wordEntry.update({ where: { id: existing.id }, data: fill });
        }
        entryId = existing.id;
      } else {
        let list = await tx.wordList.findFirst({
          where: { userId: auth.user.id, name: LOOKUP_LIST_NAME },
          orderBy: { createdAt: "asc" },
        });
        if (!list) {
          list = await tx.wordList.create({
            data: { userId: auth.user.id, name: LOOKUP_LIST_NAME, source: "manual" },
          });
        }
        const created = await tx.wordEntry.create({
          data: { listId: list.id, word, ...fields },
        });
        await tx.cardState.create({
          data: { userId: auth.user.id, entryId: created.id, status: "new" },
        });
        entryId = created.id;
      }

      // 手动加入视为一次错误；同一 entryId 只保留一条错词本记录
      const wrong = await tx.wrongBookItem.upsert({
        where: { userId_entryId: { userId: auth.user.id, entryId } },
        create: {
          userId: auth.user.id,
          entryId,
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

      return { entryId, wrongBookId: wrong.id };
    });

    return jsonWithSession({ ok: true, ...result }, auth, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "加入错词本失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
