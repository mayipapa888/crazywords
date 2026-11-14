import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseStringArray, toJsonArray } from "@/lib/json";
import { getOrCreateDemoUser } from "@/lib/user";

async function assertOwned(entryId: string) {
  const user = await getOrCreateDemoUser();
  const entry = await prisma.wordEntry.findUnique({
    where: { id: entryId },
    include: { list: true },
  });
  if (!entry || entry.list.userId !== user.id) return null;
  return { user, entry };
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await assertOwned(id);
  if (!owned) return NextResponse.json({ error: "未找到" }, { status: 404 });
  const e = owned.entry;
  return NextResponse.json({
    entry: {
      ...e,
      phrases: parseStringArray(e.phrases),
      related: parseStringArray(e.related),
    },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await assertOwned(id);
  if (!owned) return NextResponse.json({ error: "未找到" }, { status: 404 });
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.word != null) data.word = String(body.word).trim();
  if (body.glossZh !== undefined) data.glossZh = body.glossZh?.trim() || null;
  if (body.ipa !== undefined) data.ipa = body.ipa?.trim() || null;
  if (body.pos !== undefined) data.pos = body.pos?.trim() || null;
  if (body.example !== undefined) data.example = body.example?.trim() || null;
  if (Array.isArray(body.phrases)) data.phrases = toJsonArray(body.phrases);
  if (Array.isArray(body.related)) data.related = toJsonArray(body.related);

  try {
    const entry = await prisma.wordEntry.update({ where: { id }, data });
    return NextResponse.json({
      entry: {
        ...entry,
        phrases: parseStringArray(entry.phrases),
        related: parseStringArray(entry.related),
      },
    });
  } catch {
    return NextResponse.json({ error: "更新失败（可能单词重复）" }, { status: 400 });
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await assertOwned(id);
  if (!owned) return NextResponse.json({ error: "未找到" }, { status: 404 });
  await prisma.wordEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
