import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { getTtsProvider } from "@/lib/speech";

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json();
    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "缺少 text" }, { status: 400 });
    }

    const tts = getTtsProvider();
    const result = await tts.synthesize(text, { language: body.language || "zh-CN" });
    return jsonWithSession(result, auth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TTS 失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
