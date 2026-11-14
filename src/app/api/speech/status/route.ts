import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { speechStatusSnapshot } from "@/lib/speech";

/** 不返回任何密钥，仅说明当前语音提供方与配置是否齐全。 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    try {
      return jsonWithSession(speechStatusSnapshot(), auth);
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : "语音配置无效",
          provider: null,
          ready: false,
        },
        { status: 502 },
      );
    }
  } catch (e) {
    return errorJson(e, 401);
  }
}
