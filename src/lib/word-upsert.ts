import type { ParsedEntry } from "./csv-import";
import { prisma } from "./db";

export async function upsertEntriesForUser(opts: {
  userId: string;
  listId?: string;
  listName?: string;
  source?: string;
  entries: ParsedEntry[];
}) {
  let list = opts.listId
    ? await prisma.wordList.findFirst({ where: { id: opts.listId, userId: opts.userId } })
    : null;

  if (!list) {
    list = await prisma.wordList.create({
      data: {
        userId: opts.userId,
        name: opts.listName || "导入词表",
        source: opts.source || "import",
      },
    });
  }

  let created = 0;
  let updated = 0;
  let lastEntryId: string | null = null;

  for (const row of opts.entries) {
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
      lastEntryId = existing.id;
      updated += 1;
    } else {
      const entry = await prisma.wordEntry.create({
        data: { listId: list.id, ...row },
      });
      await prisma.cardState.create({
        data: { userId: opts.userId, entryId: entry.id, status: "new" },
      });
      lastEntryId = entry.id;
      created += 1;
    }
  }

  return {
    listId: list.id,
    listName: list.name,
    created,
    updated,
    total: opts.entries.length,
    lastEntryId,
  };
}
