import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { getAsrProvider } from "@/lib/speech";
import { getOrCreateDemoUser } from "@/lib/user";

export async function POST(req: Request) {
  const user = await getOrCreateDemoUser();
  const contentType = req.headers.get("content-type") || "";

  let query = "";
  let fromAsr = false;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("audio");
    const text = form.get("text");
    if (file && file instanceof File) {
      const audio = Buffer.from(await file.arrayBuffer());
      const asr = getAsrProvider();
      const hint = text ? String(text) : undefined;
      const result = await asr.recognize(audio, {
        language: "en-US",
        hint: process.env.SPEECH_PROVIDER === "mock" ? hint : undefined,
      });
      query = result.text;
      fromAsr = true;
    } else if (text) {
      query = String(text);
    }
  } else {
    const body = await req.json();
    if (body.audioBase64) {
      const audio = Buffer.from(body.audioBase64, "base64");
      const asr = getAsrProvider();
      const result = await asr.recognize(audio, {
        language: "en-US",
        hint: process.env.SPEECH_PROVIDER === "mock" ? body.hint || body.text : undefined,
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
    where: { userId: user.id },
    select: { id: true },
  });
  const candidates = await prisma.wordEntry.findMany({
    where: { listId: { in: lists.map((l) => l.id) } },
  });
  // SQLite 默认大小写敏感；查词按小写比对
  const entry = candidates.find((e) => e.word.toLowerCase() === query) || null;

  if (!entry) {
    return NextResponse.json({
      query,
      fromAsr,
      found: false,
      message: "词库中无此词",
    });
  }

  return NextResponse.json({
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
  });
}
