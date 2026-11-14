import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = auth.user;
    return jsonWithSession(
      {
        id: user.id,
        locale: user.locale,
        dailyGoalDefault: user.dailyGoalDefault,
        clozeEnabled: user.clozeEnabled,
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json();
    const data: { dailyGoalDefault?: number; clozeEnabled?: boolean } = {};
    if (typeof body.dailyGoalDefault === "number" && body.dailyGoalDefault > 0) {
      data.dailyGoalDefault = Math.min(200, Math.floor(body.dailyGoalDefault));
    }
    if (typeof body.clozeEnabled === "boolean") {
      data.clozeEnabled = body.clozeEnabled;
    }
    const updated = await prisma.user.update({
      where: { id: auth.user.id },
      data,
    });
    return jsonWithSession(
      {
        id: updated.id,
        locale: updated.locale,
        dailyGoalDefault: updated.dailyGoalDefault,
        clozeEnabled: updated.clozeEnabled,
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}
