import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

function clampTimer(n: unknown, fallback: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(300, Math.max(1, Math.floor(n)));
}

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
        autoSubmitSeconds: user.autoSubmitSeconds,
        autoStartRecordSeconds: user.autoStartRecordSeconds,
        autoNextWordSeconds: user.autoNextWordSeconds,
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
    const data: {
      dailyGoalDefault?: number;
      clozeEnabled?: boolean;
      autoSubmitSeconds?: number;
      autoStartRecordSeconds?: number;
      autoNextWordSeconds?: number;
    } = {};
    if (typeof body.dailyGoalDefault === "number" && body.dailyGoalDefault > 0) {
      data.dailyGoalDefault = Math.min(200, Math.floor(body.dailyGoalDefault));
    }
    if (typeof body.clozeEnabled === "boolean") {
      data.clozeEnabled = body.clozeEnabled;
    }
    if (body.autoSubmitSeconds != null) {
      data.autoSubmitSeconds = clampTimer(body.autoSubmitSeconds, 15);
    }
    if (body.autoStartRecordSeconds != null) {
      data.autoStartRecordSeconds = clampTimer(body.autoStartRecordSeconds, 10);
    }
    if (body.autoNextWordSeconds != null) {
      data.autoNextWordSeconds = clampTimer(body.autoNextWordSeconds, 30);
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
        autoSubmitSeconds: updated.autoSubmitSeconds,
        autoStartRecordSeconds: updated.autoStartRecordSeconds,
        autoNextWordSeconds: updated.autoNextWordSeconds,
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}
