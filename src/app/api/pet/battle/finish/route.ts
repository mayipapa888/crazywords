import type { AuthResult } from "@/lib/auth";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  EMPTY_BREAKDOWN,
  battleExp,
  dayKey,
  parseDailyExp,
  settleTickets,
  stageOfExp,
} from "@/lib/pet/rules";
import {
  ensurePet,
  loadPointsState,
  statusError,
  toPayload,
  withRetryableTransaction,
} from "@/lib/pet/server";

/**
 * 吃鸡结算：按名次 + 击杀把经验加到 Pet.exp，并执行券结算。
 *
 * 幂等：同一 recordId 只结算一次。已结束的记录直接返回当时入账的 expGained，
 * 不重复加经验，也不重复发券（券结算同样以 milestoneIssued / 旧 stage 为水位线）。
 */
export const dynamic = "force-dynamic";

/** 解析非负整数；超出范围返回 null（由调用方回 400） */
function readInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return v >= min && v <= max ? v : null;
}

export async function POST(req: Request) {
  let auth: AuthResult | null = null;
  try {
    auth = await requireUser(req);
    const userId = auth.user.id;

    const raw: unknown = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const recordId = typeof body.recordId === "string" ? body.recordId.trim() : "";
    if (!recordId) return errorJson(statusError("recordId 不能为空", 400), 400);

    const kills = readInt(body.kills, 0, 100);
    const placement = readInt(body.placement, 1, 100);
    const seconds = readInt(body.seconds, 0, 24 * 60 * 60);
    if (kills === null) return errorJson(statusError("kills 不合法", 400), 400);
    if (placement === null) return errorJson(statusError("placement 不合法", 400), 400);
    if (seconds === null) return errorJson(statusError("seconds 不合法", 400), 400);

    const outcome = await withRetryableTransaction(() =>
      prisma.$transaction(async (tx) => {
        const record = await tx.battleRecord.findFirst({
          where: { id: recordId, userId },
        });
        if (!record) throw statusError("战绩不存在", 404);

        // 已结算：幂等返回当时的结果（名次/击杀经验按存库数据重算，不写库）
        if (record.status === "finished") {
          const pet = await ensurePet(tx, userId);
          return {
            record,
            pet,
            alreadySettled: true,
            breakdown: battleExp(record.kills, record.placement),
          };
        }

        const computed = battleExp(kills, placement);
        const updatedRecord = await tx.battleRecord.update({
          where: { id: record.id },
          data: {
            status: "finished",
            kills,
            placement,
            seconds,
            expGained: computed.total,
            finishedAt: new Date(),
          },
        });

        const pet = await ensurePet(tx, userId);
        const previousStage = stageOfExp(pet.exp);
        const exp = Math.max(0, pet.exp) + computed.total;
        const stage = stageOfExp(exp);
        const ticketState = settleTickets({
          tickets: pet.tickets,
          exp,
          milestoneIssued: pet.milestoneIssued,
          fromStage: previousStage,
          toStage: stage,
        });
        const updatedPet = await tx.pet.update({
          where: { userId },
          data: {
            exp,
            stage,
            tickets: ticketState.tickets,
            milestoneIssued: ticketState.milestoneIssued,
          },
        });

        return {
          record: updatedRecord,
          pet: updatedPet,
          alreadySettled: false,
          breakdown: computed,
        };
      }),
    );

    const today = dayKey(new Date());
    const points = await loadPointsState(userId);
    const breakdown =
      outcome.pet.lastExpDate === today
        ? parseDailyExp(outcome.pet.dailyExpJson)
        : { ...EMPTY_BREAKDOWN };

    return jsonWithSession(
      {
        ok: true,
        expGained: outcome.record.expGained,
        breakdown: {
          placement: outcome.breakdown.placement,
          kills: outcome.breakdown.kills,
        },
        alreadySettled: outcome.alreadySettled,
        kills: outcome.record.kills,
        placement: outcome.record.placement,
        seconds: outcome.record.seconds,
        record: {
          id: outcome.record.id,
          status: outcome.record.status,
          kills: outcome.record.kills,
          placement: outcome.record.placement,
          seconds: outcome.record.seconds,
          expGained: outcome.record.expGained,
          createdAt: outcome.record.createdAt.toISOString(),
        },
        pet: toPayload({
          pet: outcome.pet,
          today,
          breakdown,
          points,
        }),
      },
      auth,
    );
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return errorJson(e, status);
    }
    return errorJson(e, 500);
  }
}
