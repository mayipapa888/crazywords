import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildRandomQueue,
  buildTodayQueue,
  buildWrongQueue,
  type QueueBuild,
} from "@/lib/srs/queue";

type QueueSource = "today" | "random" | "wrong";

/** 随机 / 错词本听写固定取 20 个（今日队列仍按 dailyGoalDefault） */
const EXTRA_QUEUE_SIZE = 20;

function parseSource(value: unknown): QueueSource {
  const source = String(value ?? "today");
  if (source === "random" || source === "wrong") return source;
  return "today";
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const raw = await req.json().catch(() => null);
    const source = parseSource(
      raw && typeof raw === "object" ? (raw as { source?: unknown }).source : undefined,
    );
    const clozeEnabled = auth.user.clozeEnabled;

    let queue: QueueBuild;
    if (source === "random") {
      queue = await buildRandomQueue(auth.user.id, EXTRA_QUEUE_SIZE, clozeEnabled);
    } else if (source === "wrong") {
      queue = await buildWrongQueue(auth.user.id, EXTRA_QUEUE_SIZE, clozeEnabled);
    } else {
      queue = await buildTodayQueue(
        auth.user.id,
        auth.user.dailyGoalDefault,
        clozeEnabled,
      );
    }

    if (queue.items.length === 0) {
      const message =
        source === "wrong"
          ? "错词本没有可听写的词"
          : source === "random"
            ? "词表里没有可听写的词。请先导入词表，并确保词条有中文释义。"
            : "今日队列为空。请先导入词表，并确保词条有释义或例句。";
      return errorJson(Object.assign(new Error(message), { status: 400 }), 400);
    }

    const session = await prisma.session.create({
      data: {
        userId: auth.user.id,
        date: queue.date,
        goalN: queue.goalN,
        queueSnapshot: JSON.stringify(queue.items),
        clozeEnabledSnapshot: clozeEnabled,
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
