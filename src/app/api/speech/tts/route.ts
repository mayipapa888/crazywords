import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { getSpeechProviderName, getTtsProvider } from "@/lib/speech";

/**
 * 听写播报：SPEECH_PROVIDER=aliyun 时必须返回阿里云合成音频（audioBase64）。
 * mock 可不返回音频，由前端仅在 mock 下用浏览器 SpeechSynthesis 顶替。
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json();
    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "缺少 text" }, { status: 400 });
    }

    let providerName: ReturnType<typeof getSpeechProviderName>;
    try {
      providerName = getSpeechProviderName();
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "SPEECH_PROVIDER 无效" },
        { status: 502 },
      );
    }

    const tts = getTtsProvider();
    const result = await tts.synthesize(text, {
      language: body.language || "zh-CN",
    });

    if (providerName === "aliyun") {
      if (result.mock || !result.audioBase64) {
        return NextResponse.json(
          {
            error:
              "阿里云 TTS 未返回音频。请检查 TTS_*（或 ASR_*）密钥、NLS 项目是否开通「语音合成」，且 SPEECH_PROVIDER=aliyun。",
            provider: result.provider,
          },
          { status: 502 },
        );
      }
    }

    return jsonWithSession(result, auth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TTS 失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
