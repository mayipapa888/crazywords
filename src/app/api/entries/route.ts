import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { entryCompleteness, parseStringArray } from "@/lib/json";
import { getOrCreateDemoUser } from "@/lib/user";

export async function GET(req: Request) {
  const user = await getOrCreateDemoUser();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim().toLowerCase();
  const listId = searchParams.get("listId");

  const lists = await prisma.wordList.findMany({
    where: { userId: user.id, ...(listId ? { id: listId } : {}) },
    select: { id: true },
  });
  const listIds = lists.map((l) => l.id);

  const entries = await prisma.wordEntry.findMany({
    where: {
      listId: { in: listIds },
      ...(q
        ? {
            OR: [
              { word: { contains: q } },
              { glossZh: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { word: "asc" },
  });

  const payload = entries.map((e) => {
    const { incomplete, reasons } = entryCompleteness(e);
    return {
      ...e,
      phrases: parseStringArray(e.phrases),
      related: parseStringArray(e.related),
      incomplete,
      incompleteReasons: reasons,
    };
  });

  return NextResponse.json({ entries: payload });
}
