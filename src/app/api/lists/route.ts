import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/user";

export async function GET() {
  const user = await getOrCreateDemoUser();
  const lists = await prisma.wordList.findMany({
    where: { userId: user.id },
    include: { _count: { select: { entries: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ lists });
}

export async function POST(req: Request) {
  const user = await getOrCreateDemoUser();
  const body = await req.json();
  const name = (body.name || "默认词表").trim();
  const list = await prisma.wordList.create({
    data: { userId: user.id, name, source: body.source || "manual" },
  });
  return NextResponse.json({ list }, { status: 201 });
}
