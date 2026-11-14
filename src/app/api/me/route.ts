import { NextResponse } from "next/server";
import { getOrCreateDemoUser } from "@/lib/user";

export async function GET() {
  const user = await getOrCreateDemoUser();
  return NextResponse.json({
    id: user.id,
    locale: user.locale,
    dailyGoalDefault: user.dailyGoalDefault,
    clozeEnabled: user.clozeEnabled,
  });
}

export async function PATCH(req: Request) {
  const user = await getOrCreateDemoUser();
  const body = await req.json();
  const data: { dailyGoalDefault?: number; clozeEnabled?: boolean } = {};
  if (typeof body.dailyGoalDefault === "number" && body.dailyGoalDefault > 0) {
    data.dailyGoalDefault = Math.min(200, Math.floor(body.dailyGoalDefault));
  }
  if (typeof body.clozeEnabled === "boolean") {
    data.clozeEnabled = body.clozeEnabled;
  }
  const updated = await (await import("@/lib/db")).prisma.user.update({
    where: { id: user.id },
    data,
  });
  return NextResponse.json({
    id: updated.id,
    locale: updated.locale,
    dailyGoalDefault: updated.dailyGoalDefault,
    clozeEnabled: updated.clozeEnabled,
  });
}
