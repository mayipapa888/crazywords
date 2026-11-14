import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { buildTodayQueue } from "@/lib/srs/queue";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const queue = await buildTodayQueue(
      auth.user.id,
      auth.user.dailyGoalDefault,
      auth.user.clozeEnabled,
    );
    return jsonWithSession({ ...queue, clozeEnabled: auth.user.clozeEnabled }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
