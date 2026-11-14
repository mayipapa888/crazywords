import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { assertByteLimit, bufferFromBase64, MAX_AUDIO_BYTES } from "@/lib/limits";
import { getAsrProvider, getSpeechProviderName } from "@/lib/speech";

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const contentType = req.headers.get("content-type") || "";
    let audio: Buffer | null = null;
    let hint: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("audio");
      hint = form.get("hint") ? String(form.get("hint")) : undefined;
      if (file && file instanceof File) {
        assertByteLimit(file.size, MAX_AUDIO_BYTES, "音频");
        audio = Buffer.from(await file.arrayBuffer());
      }
    } else {
      const body = await req.json();
      hint = body.hint;
      if (body.audioBase64) {
        audio = bufferFromBase64(String(body.audioBase64), MAX_AUDIO_BYTES, "音频");
      }
    }

    if (!audio || audio.length === 0) {
      return NextResponse.json({ error: "缺少音频" }, { status: 400 });
    }

    const asr = getAsrProvider();
    const useHint = getSpeechProviderName() === "mock";
    const result = await asr.recognize(audio, {
      language: "en-US",
      hint: useHint ? hint : undefined,
    });
    return jsonWithSession(result, auth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ASR 失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
