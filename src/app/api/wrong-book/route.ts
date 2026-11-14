import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { getOrCreateDemoUser } from "@/lib/user";

export async function GET() {
  const user = await getOrCreateDemoUser();
  const items = await prisma.wrongBookItem.findMany({
    where: { userId: user.id, active: true },
    include: { entry: true },
    orderBy: { lastWrongAt: "desc" },
  });

  return NextResponse.json({
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
  });
}
