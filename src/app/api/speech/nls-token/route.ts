import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { getNlsToken } from "@/lib/speech/aliyun-token";
import {
  getAsrSessionSettings,
  getSpeechProviderName,
  nlsRegion,
  nlsWsUrl,
  requireSpeechKeys,
} from "@/lib/speech/config";

/**
 * 为浏览器实时识别签发短期 NLS Token。
 * 仅 SPEECH_PROVIDER=mock 时返回 mock（不签发）。
 * SPEECH_PROVIDER=aliyun 时必须能 CreateToken，缺密钥明确 502，绝不静默 mock。
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    let provider: ReturnType<typeof getSpeechProviderName>;
    try {
      provider = getSpeechProviderName();
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "SPEECH_PROVIDER 无效" },
        { status: 502 },
      );
    }

    const region = nlsRegion();
    const wsUrl = nlsWsUrl();

    if (provider === "mock") {
      return jsonWithSession(
        {
          provider: "mock",
          mock: true,
          wsUrl: null,
          token: null,
          appkey: null,
          note: "SPEECH_PROVIDER=mock：前端模拟实时识别。生产请设 aliyun，开通「实时语音识别」，并配置 ASR_*。",
        },
        auth,
      );
    }

    // aliyun：缺密钥直接抛错 → 502，禁止返回 mock:true
    const keys = requireSpeechKeys("ASR");
    const token = await getNlsToken({
      accessKeyId: keys.accessKeyId,
      accessKeySecret: keys.accessKeySecret,
      region,
    });

    return jsonWithSession(
      {
        provider: "aliyun",
        mock: false,
        token,
        appkey: keys.appKey,
        wsUrl,
        region,
        // 采样率/热词/断句参数由服务端 env 统一配置，浏览器只负责按此采集与重采样
        asr: getAsrSessionSettings(),
        note: "浏览器将连接 SpeechTranscriber WebSocket。请确保项目已开通「实时语音识别」；英文需在 NLS 控制台项目里选择英文模型（协议不支持 model 参数）。",
      },
      auth,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "签发 Token 失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
