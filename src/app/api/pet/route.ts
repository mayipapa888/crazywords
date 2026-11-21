import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sanitizePetName } from "@/lib/pet/rules";
import { feedPet, loadPointsState, settlePet, toPayload } from "@/lib/pet/server";

/**
 * 宠物状态接口。
 *
 * 不做事物流水：每次 GET（以及 POST feed / rename 返回前）从既有学习数据
 * 惰性推导「今天应得的 EXP」，与 Pet.lastExpDate / dailyExpJson 比较后补差额。
 * 同一天内源数据只会增长，因此按来源取 max 合并即可，不会重复发经验。
 *
 * 券的发放只发生在两条路径：本文件的惰性结算（GET）与战绩结算（battle/finish）。
 * 两者都走 rules.settleTickets：以 Pet.milestoneIssued 为水位线补发里程碑券、
 * 以库里旧 stage 为起点发升阶券，因此重复调用不会重复发券。
 *
 * 结算与返回结构的实现集中在 src/lib/pet/server.ts，供 battle 路由复用。
 */

/** 每次请求都要读库并可能写回结算结果，禁止静态化/缓存 */
export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return errorJson(Object.assign(new Error(message), { status: 400 }), 400);
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const settled = await settlePet(auth.user.id);
    const points = await loadPointsState(auth.user.id);
    return jsonWithSession(
      {
        pet: toPayload({
          pet: settled.pet,
          today: settled.today,
          breakdown: settled.breakdown,
          points,
        }),
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const raw: unknown = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const action = body.action;

    if (action === "rename") {
      const parsed = sanitizePetName(body.name);
      if (!parsed.ok) return badRequest(parsed.error);

      // upsert 同时覆盖「首次进入」与「改名」，避免额外一次查询
      await prisma.pet.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id, name: parsed.value },
        update: { name: parsed.value },
      });

      const settled = await settlePet(auth.user.id);
      const points = await loadPointsState(auth.user.id);
      return jsonWithSession(
        {
          pet: toPayload({
            pet: settled.pet,
            today: settled.today,
            breakdown: settled.breakdown,
            points,
          }),
        },
        auth,
      );
    }

    if (action === "feed") {
      const fed = await feedPet(auth.user.id);
      return jsonWithSession(
        {
          ok: true,
          pet: toPayload({
            pet: fed.pet,
            today: fed.today,
            breakdown: fed.breakdown,
            points: fed.points,
          }),
        },
        auth,
      );
    }

    return badRequest("action 必须是 rename 或 feed");
  } catch (e) {
    return errorJson(e, 400);
  }
}
