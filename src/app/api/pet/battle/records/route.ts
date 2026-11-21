import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** 最近 10 条已结束的吃鸡战绩（按创建时间倒序） */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const records = await prisma.battleRecord.findMany({
      where: { userId: auth.user.id, status: "finished" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        kills: true,
        placement: true,
        seconds: true,
        expGained: true,
        createdAt: true,
        finishedAt: true,
      },
    });

    return jsonWithSession(
      {
        records: records.map((record) => ({
          id: record.id,
          kills: record.kills,
          placement: record.placement,
          seconds: record.seconds,
          expGained: record.expGained,
          createdAt: record.createdAt.toISOString(),
          finishedAt: record.finishedAt ? record.finishedAt.toISOString() : null,
        })),
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 500);
  }
}
