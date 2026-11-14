import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { parseWordCsv } from "../src/lib/csv-import";

const prisma = new PrismaClient();

async function upsertListEntries(
  userId: string,
  listName: string,
  source: string,
  csvPath: string,
) {
  const text = fs.readFileSync(csvPath, "utf8");
  const { entries, errors } = parseWordCsv(text);
  if (errors.length) {
    console.warn(`[seed] ${listName} parse warnings:`, errors.slice(0, 5));
  }

  let list = await prisma.wordList.findFirst({ where: { userId, name: listName } });
  if (!list) {
    list = await prisma.wordList.create({
      data: { userId, name: listName, source },
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
      await prisma.cardState.upsert({
        where: { userId_entryId: { userId, entryId: existing.id } },
        create: { userId, entryId: existing.id, status: "new" },
        update: {},
      });
    } else {
      const entry = await prisma.wordEntry.create({
        data: { listId: list.id, ...row },
      });
      await prisma.cardState.create({
        data: { userId, entryId: entry.id, status: "new" },
      });
      created += 1;
    }
  }
  console.log(`[seed] ${listName}: created=${created} updated=${updated} total=${entries.length}`);
  return entries.length;
}

async function main() {
  let user = await prisma.user.findFirst({
    where: { sessionKey: "seed-demo-user" },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        sessionKey: "seed-demo-user",
        locale: "zh-CN",
        dailyGoalDefault: 20,
        clozeEnabled: true,
      },
    });
  }

  const root = process.cwd();
  const sampleCsv = path.join(root, "samples", "words.sample.csv");
  const shanghaiCsv = path.join(root, "samples", "shanghai-zhongkao-2026.csv");

  if (fs.existsSync(sampleCsv)) {
    await upsertListEntries(user.id, "默认样例词表", "seed", sampleCsv);
  }

  if (fs.existsSync(shanghaiCsv)) {
    await upsertListEntries(user.id, "上海初中考纲 2026", "seed-shanghai-2026", shanghaiCsv);
  } else {
    console.warn("[seed] missing samples/shanghai-zhongkao-2026.csv");
  }

  console.log(`Seeded for user sessionKey=seed-demo-user id=${user.id}`);
  console.log(
    "提示：浏览器会话用户与 seed 用户不同；可将 CSV 在「导入」页上传到自己的会话，或复制 seed 数据。",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
