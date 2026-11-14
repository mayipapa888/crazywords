import { NextResponse } from "next/server";
import { getTtsProvider } from "@/lib/speech";

export async function POST(req: Request) {
  const body = await req.json();
  const text = String(body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "缺少 text" }, { status: 400 });
  }

  try {
    const tts = getTtsProvider();
    const result = await tts.synthesize(text, { language: body.language || "zh-CN" });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "TTS 失败" },
      { status: 502 },
    );
  }
}
