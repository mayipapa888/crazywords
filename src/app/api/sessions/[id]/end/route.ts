import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDemoUser } from "@/lib/user";

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDemoUser();
  const session = await prisma.session.findFirst({
    where: { id, userId: user.id },
  });
  if (!session) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  const updated = await prisma.session.update({
    where: { id },
    data: { endedAt: new Date() },
  });
  return NextResponse.json({ sessionId: updated.id, endedAt: updated.endedAt });
}
