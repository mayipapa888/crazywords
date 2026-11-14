import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;
    const session = await prisma.session.findFirst({
      where: { id, userId: auth.user.id },
    });
    if (!session) {
      return errorJson(Object.assign(new Error("会话不存在"), { status: 404 }), 404);
    }
    const updated = await prisma.session.update({
      where: { id },
      data: { endedAt: new Date() },
    });
    return jsonWithSession({ sessionId: updated.id, endedAt: updated.endedAt }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
