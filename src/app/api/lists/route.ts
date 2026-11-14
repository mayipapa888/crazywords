import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const lists = await prisma.wordList.findMany({
      where: { userId: auth.user.id },
      include: { _count: { select: { entries: true } } },
      orderBy: { createdAt: "asc" },
    });
    return jsonWithSession({ lists }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json();
    const name = (body.name || "默认词表").trim();
    const list = await prisma.wordList.create({
      data: { userId: auth.user.id, name, source: body.source || "manual" },
    });
    return jsonWithSession({ list }, auth, { status: 201 });
  } catch (e) {
    return errorJson(e, 401);
  }
}
