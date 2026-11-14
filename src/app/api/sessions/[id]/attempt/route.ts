import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAsrProvider } from "@/lib/speech";
import { checkPronunciation, checkSpelling } from "@/lib/spelling";
import { applyGrade } from "@/lib/srs/schedule";
import { getOrCreateDemoUser } from "@/lib/user";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await ctx.params;
  const user = await getOrCreateDemoUser();

  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId: user.id },
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

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    entryId = String(form.get("entryId") || "");
    mode = String(form.get("mode") || "gloss") === "cloze" ? "cloze" : "gloss";
    spellingInput = String(form.get("spellingInput") || "");
    skipAsr = String(form.get("skipAsr") || "") === "1";
    const file = form.get("audio");
    if (file && file instanceof File) {
      audio = Buffer.from(await file.arrayBuffer());
    }
  } else {
    const body = await req.json();
    entryId = body.entryId;
    mode = body.mode === "cloze" ? "cloze" : "gloss";
    spellingInput = body.spellingInput || "";
    skipAsr = Boolean(body.skipAsr);
    if (body.audioBase64) {
      audio = Buffer.from(body.audioBase64, "base64");
    }
  }

  const entry = await prisma.wordEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    return NextResponse.json({ error: "词条不存在" }, { status: 404 });
  }

  const spellingOk = checkSpelling(spellingInput, entry.word);

  let asrTranscript: string | null = null;
  let pronunciationOk = false;

  if (skipAsr) {
    // 硬约束：禁止仅拼写通过
    return NextResponse.json(
      { error: "必须录音判定发音，不能跳过语音" },
      { status: 400 },
    );
  }

  if (!audio || audio.length === 0) {
    return NextResponse.json(
      { error: "缺少录音。听写必须提交语音，无麦克风不可完成。" },
      { status: 400 },
    );
  }

  const asr = getAsrProvider();
  // mock：用目标词作 hint，便于本地联调 UI；真厂商接入后应去掉 hint 作弊
  const asrResult = await asr.recognize(audio, {
    language: "en-US",
    hint: process.env.SPEECH_PROVIDER === "mock" ? entry.word : undefined,
  });
  asrTranscript = asrResult.text;
  pronunciationOk = checkPronunciation(asrTranscript, entry.word);

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
    where: { userId_entryId: { userId: user.id, entryId } },
  });
  if (!card) {
    card = await prisma.cardState.create({
      data: { userId: user.id, entryId, status: "new" },
    });
  }

  if (overallOk) {
    const patch = applyGrade(card, "good");
    await prisma.cardState.update({
      where: { id: card.id },
      data: patch,
    });

    const wrong = await prisma.wrongBookItem.findUnique({
      where: { userId_entryId: { userId: user.id, entryId } },
    });
    if (wrong?.active) {
      const consecutiveOk = wrong.consecutiveOk + 1;
      await prisma.wrongBookItem.update({
        where: { id: wrong.id },
        data: {
          consecutiveOk,
          active: consecutiveOk < 2,
        },
      });
    }
  } else {
    const patch = applyGrade(card, "again");
    await prisma.cardState.update({
      where: { id: card.id },
      data: patch,
    });

    const kinds =
      !spellingOk && !pronunciationOk
        ? "both"
        : !spellingOk
          ? "spelling"
          : "pronunciation";

    await prisma.wrongBookItem.upsert({
      where: { userId_entryId: { userId: user.id, entryId } },
      create: {
        userId: user.id,
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

  return NextResponse.json({
    attemptId: attempt.id,
    spellingOk,
    pronunciationOk,
    overallOk,
    asrTranscript,
    asrProvider: asr.name,
    answer: {
      word: entry.word,
      glossZh: entry.glossZh,
      ipa: entry.ipa,
      pos: entry.pos,
      example: entry.example,
    },
  });
}
