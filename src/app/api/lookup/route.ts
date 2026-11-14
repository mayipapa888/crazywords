import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { assertByteLimit, bufferFromBase64, MAX_AUDIO_BYTES } from "@/lib/limits";
import { getAsrProvider, getSpeechProviderName } from "@/lib/speech";

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const contentType = req.headers.get("content-type") || "";

    let query = "";
    let fromAsr = false;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("audio");
      const text = form.get("text");
      if (file && file instanceof File) {
        assertByteLimit(file.size, MAX_AUDIO_BYTES, "音频");
        const audio = Buffer.from(await file.arrayBuffer());
        const asr = getAsrProvider();
        const hint = text ? String(text) : undefined;
        const useHint = getSpeechProviderName() === "mock";
        const result = await asr.recognize(audio, {
          language: "en-US",
          hint: useHint ? hint : undefined,
        });
        query = result.text;
        fromAsr = true;
      } else if (text) {
        query = String(text);
      }
    } else {
      const body = await req.json();
      if (body.audioBase64) {
        const audio = bufferFromBase64(String(body.audioBase64), MAX_AUDIO_BYTES, "音频");
        const asr = getAsrProvider();
        const useHint = getSpeechProviderName() === "mock";
        const result = await asr.recognize(audio, {
          language: "en-US",
          hint: useHint ? body.hint || body.text : undefined,
        });
        query = result.text;
        fromAsr = true;
      } else {
        query = String(body.text || body.q || "");
      }
    }

    query = query.trim().toLowerCase().replace(/[^\w'-]/g, "");
    if (!query) {
      return NextResponse.json({ error: "未识别到单词" }, { status: 400 });
    }

    const lists = await prisma.wordList.findMany({
      where: { userId: auth.user.id },
      select: { id: true },
    });
    const candidates = await prisma.wordEntry.findMany({
      where: { listId: { in: lists.map((l) => l.id) } },
    });
    const entry = candidates.find((e) => e.word.toLowerCase() === query) || null;

    if (!entry) {
      return jsonWithSession(
        { query, fromAsr, found: false, message: "词库中无此词" },
        auth,
      );
    }

    return jsonWithSession(
      {
        query,
        fromAsr,
        found: true,
        entry: {
          id: entry.id,
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
    const msg = e instanceof Error ? e.message : "查词失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
