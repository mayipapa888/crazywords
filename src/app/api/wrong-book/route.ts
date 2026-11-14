import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const items = await prisma.wrongBookItem.findMany({
      where: { userId: auth.user.id, active: true },
      include: { entry: true },
      orderBy: { lastWrongAt: "desc" },
    });

    return jsonWithSession(
      {
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
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}
