import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { getNlsToken } from "@/lib/speech/aliyun-token";

/**
 * 为浏览器实时识别签发短期 NLS Token。
 * mock 模式不签发真实 Token。
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const provider = (process.env.SPEECH_PROVIDER || "mock").toLowerCase();
    const region = process.env.NLS_REGION || "cn-shanghai";
    const wsUrl =
      process.env.NLS_WS_URL || `wss://nls-gateway-${region}.aliyuncs.com/ws/v1`;

    if (provider !== "aliyun") {
      return jsonWithSession(
        {
          provider: "mock",
          mock: true,
          wsUrl: null,
          token: null,
          appkey: null,
          note: "SPEECH_PROVIDER=mock：前端模拟实时识别。生产请设 aliyun 并开通「实时语音识别」。",
        },
        auth,
      );
    }

    const accessKeyId = process.env.ASR_ACCESS_KEY_ID?.trim();
    const accessKeySecret = process.env.ASR_ACCESS_KEY_SECRET?.trim();
    const appkey = process.env.ASR_APP_KEY?.trim();
    if (!accessKeyId || !accessKeySecret || !appkey) {
      return NextResponse.json(
        {
          error:
            "实时识别需配置 ASR_ACCESS_KEY_ID / ASR_ACCESS_KEY_SECRET / ASR_APP_KEY，且项目需开通实时语音识别能力",
        },
        { status: 502 },
      );
    }

    const token = await getNlsToken({ accessKeyId, accessKeySecret, region });
    return jsonWithSession(
      {
        provider: "aliyun",
        mock: false,
        token,
        appkey,
        wsUrl,
        region,
        note: "请确保 NLS 项目已开通「实时语音识别」；听写英文需选英文模型。",
      },
      auth,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "签发 Token 失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
