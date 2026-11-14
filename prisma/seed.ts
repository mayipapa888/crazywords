import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: { locale: "zh-CN", dailyGoalDefault: 20, clozeEnabled: true },
    });
  }

  let list = await prisma.wordList.findFirst({ where: { userId: user.id } });
  if (!list) {
    list = await prisma.wordList.create({
      data: { userId: user.id, name: "默认词表", source: "manual" },
    });
  }

  const samples = [
    {
      word: "abandon",
      glossZh: "放弃；遗弃",
      ipa: "/əˈbændən/",
      pos: "v.",
      example: "They had to abandon the project.",
      phrases: JSON.stringify(["abandon hope"]),
      related: JSON.stringify(["desert", "forsake"]),
    },
    {
      word: "benefit",
      glossZh: "益处；使受益",
      ipa: "/ˈbenɪfɪt/",
      pos: "n./v.",
      example: "Exercise can benefit your health.",
      phrases: JSON.stringify(["benefit from"]),
      related: JSON.stringify(["advantage"]),
    },
    {
      word: "curious",
      glossZh: "好奇的",
      ipa: "/ˈkjʊəriəs/",
      pos: "adj.",
      example: "She is curious about the world.",
      phrases: JSON.stringify(["curious about"]),
      related: JSON.stringify(["inquisitive"]),
    },
  ];

  for (const s of samples) {
    await prisma.wordEntry.upsert({
      where: { listId_word: { listId: list.id, word: s.word } },
      create: { listId: list.id, ...s },
      update: { ...s },
    });
  }

  const entries = await prisma.wordEntry.findMany({ where: { listId: list.id } });
  for (const e of entries) {
    await prisma.cardState.upsert({
      where: { userId_entryId: { userId: user.id, entryId: e.id } },
      create: { userId: user.id, entryId: e.id, status: "new" },
      update: {},
    });
  }

  console.log(`Seeded user=${user.id} list=${list.id} entries=${entries.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
