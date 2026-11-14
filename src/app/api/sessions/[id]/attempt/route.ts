import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertByteLimit, bufferFromBase64, MAX_AUDIO_BYTES } from "@/lib/limits";
import { getAsrProvider } from "@/lib/speech";
import { checkPronunciation, checkSpelling } from "@/lib/spelling";
import { applyGrade } from "@/lib/srs/schedule";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id: sessionId } = await ctx.params;

    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId: auth.user.id },
    });
    if (!session) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }

    const contentType = req.headers.get("content-type") || "";
    let entryId = "";
    let mode: "gloss" | "cloze" = "gloss";
    let spellingInput = "";
    let audio: Buffer | null = null;
    let skipAsr = false;
    let realtimeTranscript: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      entryId = String(form.get("entryId") || "");
      mode = String(form.get("mode") || "gloss") === "cloze" ? "cloze" : "gloss";
      spellingInput = String(form.get("spellingInput") || "");
      skipAsr = String(form.get("skipAsr") || "") === "1";
      if (form.get("realtimeTranscript")) {
        realtimeTranscript = String(form.get("realtimeTranscript"));
      }
      const file = form.get("audio");
      if (file && file instanceof File) {
        assertByteLimit(file.size, MAX_AUDIO_BYTES, "录音");
        audio = Buffer.from(await file.arrayBuffer());
      }
    } else {
      const body = await req.json();
      entryId = body.entryId;
      mode = body.mode === "cloze" ? "cloze" : "gloss";
      spellingInput = body.spellingInput || "";
      skipAsr = Boolean(body.skipAsr);
      if (body.realtimeTranscript != null) {
        realtimeTranscript = String(body.realtimeTranscript);
      }
      if (body.audioBase64) {
        audio = bufferFromBase64(String(body.audioBase64), MAX_AUDIO_BYTES, "录音");
      }
    }

    const entry = await prisma.wordEntry.findUnique({ where: { id: entryId } });
    if (!entry) {
      return NextResponse.json({ error: "词条不存在" }, { status: 404 });
    }

    // 确认词条属于当前用户词表
    const list = await prisma.wordList.findFirst({
      where: { id: entry.listId, userId: auth.user.id },
    });
    if (!list) {
      return NextResponse.json({ error: "无权访问该词条" }, { status: 403 });
    }

    const spellingOk = checkSpelling(spellingInput, entry.word);

    if (skipAsr) {
      return NextResponse.json(
        { error: "必须录音判定发音，不能跳过语音" },
        { status: 400 },
      );
    }

    let asrTranscript: string | null = null;
    let asrProvider = "unknown";

    if (realtimeTranscript != null && realtimeTranscript.trim() !== "") {
      // 实时识别路径：使用浏览器 WebSocket 会话产生的转写（仍要求有麦、有识别文本）
      asrTranscript = realtimeTranscript.trim();
      asrProvider =
        (process.env.SPEECH_PROVIDER || "mock").toLowerCase() === "aliyun"
          ? "aliyun-realtime"
          : "mock-realtime";
    } else if (audio && audio.length > 0) {
      const asr = getAsrProvider();
      const useHint = (process.env.SPEECH_PROVIDER || "mock").toLowerCase() === "mock";
      const asrResult = await asr.recognize(audio, {
        language: "en-US",
        hint: useHint ? entry.word : undefined,
      });
      asrTranscript = asrResult.text;
      asrProvider = asr.name;
    } else {
      return NextResponse.json(
        {
          error:
            "缺少语音结果。请使用实时识别，或上传录音。无麦克风不可完成听写。",
        },
        { status: 400 },
      );
    }

    const pronunciationOk = checkPronunciation(asrTranscript, entry.word);
    const overallOk = spellingOk && pronunciationOk;

    const attempt = await prisma.attempt.create({
      data: {
        sessionId,
        entryId,
        mode,
        spellingInput,
        spellingOk,
        asrTranscript,
        pronunciationOk,
        overallOk,
      },
    });

    let card = await prisma.cardState.findUnique({
      where: { userId_entryId: { userId: auth.user.id, entryId } },
    });
    if (!card) {
      card = await prisma.cardState.create({
        data: { userId: auth.user.id, entryId, status: "new" },
      });
    }

    if (overallOk) {
      const patch = applyGrade(card, "good");
      await prisma.cardState.update({ where: { id: card.id }, data: patch });

      const wrong = await prisma.wrongBookItem.findUnique({
        where: { userId_entryId: { userId: auth.user.id, entryId } },
      });
      if (wrong?.active) {
        const consecutiveOk = wrong.consecutiveOk + 1;
        await prisma.wrongBookItem.update({
          where: { id: wrong.id },
          data: { consecutiveOk, active: consecutiveOk < 2 },
        });
      }
    } else {
      const patch = applyGrade(card, "again");
      await prisma.cardState.update({ where: { id: card.id }, data: patch });

      const kinds =
        !spellingOk && !pronunciationOk
          ? "both"
          : !spellingOk
            ? "spelling"
            : "pronunciation";

      await prisma.wrongBookItem.upsert({
        where: { userId_entryId: { userId: auth.user.id, entryId } },
        create: {
          userId: auth.user.id,
          entryId,
          wrongCount: 1,
          lastWrongKinds: kinds,
          active: true,
          consecutiveOk: 0,
        },
        update: {
          wrongCount: { increment: 1 },
          lastWrongAt: new Date(),
          lastWrongKinds: kinds,
          active: true,
          consecutiveOk: 0,
        },
      });
    }

    return jsonWithSession(
      {
        attemptId: attempt.id,
        spellingOk,
        pronunciationOk,
        overallOk,
        asrTranscript,
        asrProvider,
        answer: {
          word: entry.word,
          glossZh: entry.glossZh,
          ipa: entry.ipa,
          pos: entry.pos,
          example: entry.example,
        },
      },
      auth,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "提交失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
