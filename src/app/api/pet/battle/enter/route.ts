import type { AuthResult } from "@/lib/auth";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MAX_TICKETS } from "@/lib/pet/rules";
import { ensurePet, statusError, withRetryableTransaction } from "@/lib/pet/server";

/**
 * 进入吃鸡：校验并扣减 1 张券，创建一条 playing 战绩。
 *
 * 这里不重新结算经验/券（券只在 GET /api/pet 与 battle/finish 结算），
 * 直接以库里最新的 tickets 为准；无券返回 409 + tickets: 0。
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let auth: AuthResult | null = null;
  try {
    auth = await requireUser(req);
    const userId = auth.user.id;

    const result = await withRetryableTransaction(() =>
      prisma.$transaction(async (tx) => {
        const pet = await ensurePet(tx, userId);
        const tickets = Math.min(MAX_TICKETS, Math.max(0, pet.tickets));
        if (tickets < 1) throw statusError("吃鸡券不足", 409);

        const updated = await tx.pet.update({
          where: { userId },
          data: { tickets: tickets - 1 },
        });
        const record = await tx.battleRecord.create({
          data: { userId, status: "playing" },
        });

        return { recordId: record.id, tickets: updated.tickets };
      }),
    );

    return jsonWithSession({ ok: true, recordId: result.recordId, tickets: result.tickets }, auth);
  } catch (e) {
    if (
      auth &&
      e instanceof Error &&
      (e as Error & { status?: number }).status === 409
    ) {
      return jsonWithSession({ error: "吃鸡券不足", tickets: 0 }, auth, { status: 409 });
    }
    return errorJson(e, 400);
  }
}
