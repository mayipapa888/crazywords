import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertByteLimit, bufferFromBase64, MAX_AUDIO_BYTES } from "@/lib/limits";
import {
  checkMeaning,
  extractChineseFromTranscript,
} from "@/lib/speech/extract-meaning";
import { extractLemmaFromTranscript } from "@/lib/speech/extract-lemma";
import { getAsrProvider, getSpeechProviderName } from "@/lib/speech";
import { checkPronunciation, checkSpelling } from "@/lib/spelling";
import { applyGrade } from "@/lib/srs/schedule";

type DictationMode = "gloss" | "meaning";

/** WordEntry.phrases / related 以 JSON 字符串存储，正解展示需要还原成数组 */
function parseStringArray(raw: string | null | undefined): string[] {
  try {
    const value = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item).trim())
      .filter((item) => item !== "");
  } catch {
    return [];
  }
}

function parseMode(raw: unknown): DictationMode {
  const s = String(raw || "gloss");
  if (s === "meaning" || s === "cloze") return "meaning"; // cloze 旧值兼容 → 模式 B
  return "gloss";
}

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
    let mode: DictationMode = "gloss";
    let spellingInput = "";
    let audio: Buffer | null = null;
    let skipAsr = false;
    let realtimeTranscript: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      entryId = String(form.get("entryId") || "");
      mode = parseMode(form.get("mode"));
      spellingInput = String(form.get("spellingInput") || "");
      skipAsr = String(form.get("skipAsr") || "") === "1";
      if (form.has("realtimeTranscript")) {
        realtimeTranscript = String(form.get("realtimeTranscript") ?? "");
      }
      const file = form.get("audio");
      if (file && file instanceof File) {
        assertByteLimit(file.size, MAX_AUDIO_BYTES, "录音");
        audio = Buffer.from(await file.arrayBuffer());
      }
    } else {
      const body = await req.json();
      entryId = body.entryId;
      mode = parseMode(body.mode);
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

    const list = await prisma.wordList.findFirst({
      where: { id: entry.listId, userId: auth.user.id },
    });
    if (!list) {
      return NextResponse.json({ error: "无权访问该词条" }, { status: 403 });
    }

    if (skipAsr) {
      return NextResponse.json(
        { error: "必须录音判定，不能跳过语音" },
        { status: 400 },
      );
    }

    let asrTranscript: string | null = null;
    let asrProvider = "unknown";

    if (realtimeTranscript != null) {
      // 客户端显式上报了实时识别结果（可能是空串：开录后 3 秒没说话，按答错处理）
      asrTranscript = realtimeTranscript.trim();
      asrProvider =
        getSpeechProviderName() === "aliyun"
          ? "aliyun-realtime"
          : "mock-realtime";
    } else if (audio && audio.length > 0) {
      const asr = getAsrProvider();
      const useHint = getSpeechProviderName() === "mock";
      const asrResult = await asr.recognize(audio, {
        language: mode === "meaning" ? "zh-CN" : "en-US",
        hint: useHint
          ? mode === "meaning"
            ? entry.glossZh || undefined
            : entry.word
          : undefined,
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

    let spellingOk = false;
    let pronunciationOk = false;
    let meaningOk: boolean | null = null;
    let extractedSpelling: string | null = null;
    let extractedMeaning: string | null = null;
    let overallOk = false;
    let wrongKinds = "both";

    if (mode === "meaning") {
      extractedMeaning =
        spellingInput.trim() ||
        extractChineseFromTranscript(asrTranscript || "") ||
        null;
      meaningOk = checkMeaning(asrTranscript, entry.glossZh);
      // 复用 Attempt 布尔字段：释义口述对则两者同为 true
      spellingOk = meaningOk;
      pronunciationOk = meaningOk;
      overallOk = meaningOk;
      wrongKinds = meaningOk ? "both" : "meaning";
    } else {
      extractedSpelling =
        spellingInput.trim() ||
        extractLemmaFromTranscript(asrTranscript || "", entry.word) ||
        null;
      spellingOk = checkSpelling(extractedSpelling || spellingInput, entry.word);
      pronunciationOk = checkPronunciation(asrTranscript, entry.word);
      // 语音识别本身不够准：拼写正确即算通过，发音识别误差不再判错
      overallOk = spellingOk;
      wrongKinds = !spellingOk && !pronunciationOk ? "both" : !spellingOk ? "spelling" : "pronunciation";
    }

    const attempt = await prisma.attempt.create({
      data: {
        sessionId,
        entryId,
        mode,
        spellingInput:
          mode === "meaning"
            ? extractedMeaning || spellingInput
            : extractedSpelling || spellingInput,
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

      await prisma.wrongBookItem.upsert({
        where: { userId_entryId: { userId: auth.user.id, entryId } },
        create: {
          userId: auth.user.id,
          entryId,
          wrongCount: 1,
          lastWrongKinds: wrongKinds,
          active: true,
          consecutiveOk: 0,
        },
        update: {
          wrongCount: { increment: 1 },
          lastWrongAt: new Date(),
          lastWrongKinds: wrongKinds,
          active: true,
          consecutiveOk: 0,
        },
      });
    }

    return jsonWithSession(
      {
        attemptId: attempt.id,
        mode,
        spellingOk,
        pronunciationOk,
        meaningOk,
        overallOk,
        asrTranscript,
        asrProvider,
        extractedSpelling,
        extractedMeaning,
        answer: {
          word: entry.word,
          glossZh: entry.glossZh,
          ipa: entry.ipa,
          pos: entry.pos,
          example: entry.example,
          phrases: parseStringArray(entry.phrases),
          related: parseStringArray(entry.related),
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
