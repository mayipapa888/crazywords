import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildTodayQueue } from "@/lib/srs/queue";
import { getOrCreateDemoUser } from "@/lib/user";

export async function POST() {
  const user = await getOrCreateDemoUser();
  const queue = await buildTodayQueue(user.id, user.dailyGoalDefault, user.clozeEnabled);

  if (queue.items.length === 0) {
    return NextResponse.json(
      { error: "今日队列为空。请先导入词表，并确保词条有释义或例句。" },
      { status: 400 },
    );
  }

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      date: queue.date,
      goalN: queue.goalN,
      queueSnapshot: JSON.stringify(queue.items),
      clozeEnabledSnapshot: user.clozeEnabled,
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    date: session.date,
    goalN: session.goalN,
    clozeEnabled: session.clozeEnabledSnapshot,
    items: queue.items,
    reviewDay: queue.reviewDay,
  });
}
