import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildTodayQueue } from "@/lib/srs/queue";

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const queue = await buildTodayQueue(
      auth.user.id,
      auth.user.dailyGoalDefault,
      auth.user.clozeEnabled,
    );

    if (queue.items.length === 0) {
      return errorJson(
        Object.assign(
          new Error("今日队列为空。请先导入词表，并确保词条有释义或例句。"),
          { status: 400 },
        ),
        400,
      );
    }

    const session = await prisma.session.create({
      data: {
        userId: auth.user.id,
        date: queue.date,
        goalN: queue.goalN,
        queueSnapshot: JSON.stringify(queue.items),
        clozeEnabledSnapshot: auth.user.clozeEnabled,
      },
    });

    return jsonWithSession(
      {
        sessionId: session.id,
        date: session.date,
        goalN: session.goalN,
        clozeEnabled: session.clozeEnabledSnapshot,
        items: queue.items,
        reviewDay: queue.reviewDay,
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 401);
  }
}
