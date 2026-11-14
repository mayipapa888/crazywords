import { NextResponse } from "next/server";
import { getAsrProvider } from "@/lib/speech";

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  let audio: Buffer | null = null;
  let hint: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("audio");
    hint = form.get("hint") ? String(form.get("hint")) : undefined;
    if (file && file instanceof File) {
      audio = Buffer.from(await file.arrayBuffer());
    }
  } else {
    const body = await req.json();
    hint = body.hint;
    if (body.audioBase64) {
      audio = Buffer.from(body.audioBase64, "base64");
    }
  }

  if (!audio || audio.length === 0) {
    return NextResponse.json({ error: "缺少音频" }, { status: 400 });
  }

  try {
    const asr = getAsrProvider();
    const result = await asr.recognize(audio, {
      language: "en-US",
      hint: process.env.SPEECH_PROVIDER === "mock" ? hint : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ASR 失败" },
      { status: 502 },
    );
  }
}
