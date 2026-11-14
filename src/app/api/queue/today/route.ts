import { NextResponse } from "next/server";
import { buildTodayQueue } from "@/lib/srs/queue";
import { getOrCreateDemoUser } from "@/lib/user";

export async function GET() {
  const user = await getOrCreateDemoUser();
  const queue = await buildTodayQueue(user.id, user.dailyGoalDefault, user.clozeEnabled);
  return NextResponse.json({
    ...queue,
    clozeEnabled: user.clozeEnabled,
  });
}
