import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { entryCompleteness, toJsonArray } from "@/lib/json";

/** 查词相关写入统一使用的词表名（与 /api/wrong-book 保持一致） */
const LOOKUP_LIST_NAME = "查词收藏";
/** 历史词表名：不再写入，已有数据保持原样 */
const LEGACY_LOOKUP_LIST_NAME = "查词生词";

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

/** 可选文本字段：缺省 / 空串返回 undefined（新建时用默认值，复用时视为无新值） */
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function stringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split("|");
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

/** 统一词表：空名与历史名「查词生词」一律落到「查词收藏」，其他显式词表名保持兼容 */
function resolveListName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name === LEGACY_LOOKUP_LIST_NAME) return LOOKUP_LIST_NAME;
  return name;
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

/** 新建词条的目标词表：显式 listId（须属于当前用户）→ 同名词表 → 新建 */
async function resolveTargetList(
  tx: Prisma.TransactionClient,
  userId: string,
  rawListId: unknown,
  listName: string,
) {
  const listId = typeof rawListId === "string" ? rawListId.trim() : "";
  if (listId) {
    const owned = await tx.wordList.findFirst({ where: { id: listId, userId } });
    if (owned) return owned;
  }
  const named = await tx.wordList.findFirst({
    where: { userId, name: listName },
    orderBy: { createdAt: "asc" },
  });
  if (named) return named;
  return tx.wordList.create({
    data: { userId, name: listName, source: "manual" },
  });
}

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
    const listName = resolveListName(body.listName);

    // 先查后写放在同一事务里：复用已有 entryId，绝不重复造词条
    const result = await prisma.$transaction(async (tx) => {
      const existing = await findExistingEntry(tx, auth.user.id, word);
      if (existing) {
        const fill = buildFillData(existing, fields);
        const hasFill = Object.keys(fill).length > 0;
        if (hasFill) {
          await tx.wordEntry.update({ where: { id: existing.id }, data: fill });
        }
        return {
          listId: existing.listId,
          listName: existing.list.name,
          created: 0,
          updated: hasFill ? 1 : 0,
          total: 1,
          lastEntryId: existing.id,
        };
      }

      const list = await resolveTargetList(tx, auth.user.id, body.listId, listName);
      const created = await tx.wordEntry.create({
        data: { listId: list.id, word, ...fields },
      });
      await tx.cardState.create({
        data: { userId: auth.user.id, entryId: created.id, status: "new" },
      });
      return {
        listId: list.id,
        listName: list.name,
        created: 1,
        updated: 0,
        total: 1,
        lastEntryId: created.id,
      };
    });

    // 回显请求中的字段，保持原有响应形状（前端只用 lastEntryId / overwritten）
    const entry = {
      word,
      glossZh: fields.glossZh ?? null,
      ipa: fields.ipa ?? null,
      pos: fields.pos ?? null,
      example: fields.example ?? null,
      phrases: fields.phrases ?? "[]",
      related: fields.related ?? "[]",
    };
    const { incomplete, reasons } = entryCompleteness(entry);

    return jsonWithSession(
      {
        ...result,
        entry,
        incomplete,
        incompleteReasons: reasons,
        overwritten: result.updated > 0,
      },
      auth,
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
