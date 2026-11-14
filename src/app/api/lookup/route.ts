import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enrichWord } from "@/lib/dict/enrich";
import { parseStringArray } from "@/lib/json";
import { assertByteLimit, bufferFromBase64, MAX_AUDIO_BYTES } from "@/lib/limits";
import { getAsrProvider, getSpeechProviderName } from "@/lib/speech";

function hasChinese(s: string) {
  return /[\u4e00-\u9fff]/.test(s);
}

function normalizeEn(s: string) {
  return s.trim().toLowerCase().replace(/[^\w'-]/g, "");
}

async function translateZhToEn(text: string): Promise<string | null> {
  const provider = (process.env.TRANSLATE_PROVIDER || "mymemory").toLowerCase();
  if (provider === "none" || provider === "off") return null;
  const email = process.env.MYMEMORY_EMAIL?.trim();
  const u = new URL("https://api.mymemory.translated.net/get");
  u.searchParams.set("q", text.slice(0, 450));
  u.searchParams.set("langpair", "zh-CN|en");
  if (email) u.searchParams.set("de", email);
  try {
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      responseData?: { translatedText?: string };
    };
    const en = data.responseData?.translatedText?.trim();
    if (!en || hasChinese(en)) return null;
    // 取首个英文词
    const token = normalizeEn(en.split(/\s+/)[0] || en);
    return token || null;
  } catch {
    return null;
  }
}

function serializeEntry(entry: {
  id: string;
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string;
  related: string;
}) {
  return {
    id: entry.id,
    word: entry.word,
    glossZh: entry.glossZh,
    ipa: entry.ipa,
    pos: entry.pos,
    example: entry.example,
    phrases: parseStringArray(entry.phrases),
    related: parseStringArray(entry.related),
  };
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const contentType = req.headers.get("content-type") || "";

    let queryRaw = "";
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
          language: hasChinese(String(hint || "")) ? "zh-CN" : "en-US",
          hint: useHint ? hint : undefined,
        });
        queryRaw = result.text;
        fromAsr = true;
      } else if (text) {
        queryRaw = String(text);
      }
    } else {
      const body = await req.json();
      if (body.audioBase64) {
        const audio = bufferFromBase64(String(body.audioBase64), MAX_AUDIO_BYTES, "音频");
        const asr = getAsrProvider();
        const useHint = getSpeechProviderName() === "mock";
        const hint = body.hint || body.text;
        const result = await asr.recognize(audio, {
          language: hasChinese(String(hint || "")) ? "zh-CN" : "en-US",
          hint: useHint ? hint : undefined,
        });
        queryRaw = result.text;
        fromAsr = true;
      } else {
        queryRaw = String(body.text || body.q || "");
      }
    }

    queryRaw = queryRaw.trim();
    if (!queryRaw) {
      return NextResponse.json({ error: "未识别到查询内容" }, { status: 400 });
    }

    const lists = await prisma.wordList.findMany({
      where: { userId: auth.user.id },
      select: { id: true },
    });
    const listIds = lists.map((l) => l.id);
    const candidates =
      listIds.length === 0
        ? []
        : await prisma.wordEntry.findMany({
            where: { listId: { in: listIds } },
          });

    const qEn = normalizeEn(queryRaw);
    const qZh = hasChinese(queryRaw)
      ? queryRaw.replace(/[^\u4e00-\u9fff·．.、，,\s]/g, "").replace(/\s+/g, "")
      : "";

    // 1) 本地词表：英文精确 / 中文释义包含
    const entry =
      (qEn && candidates.find((e) => e.word.toLowerCase() === qEn)) ||
      (qZh &&
        candidates.find((e) => {
          const g = (e.glossZh || "").replace(/\s+/g, "");
          return g.includes(qZh) || qZh.includes(g.replace(/[^\u4e00-\u9fff]/g, ""));
        })) ||
      null;

    if (entry) {
      return jsonWithSession(
        {
          query: queryRaw,
          fromAsr,
          found: true,
          source: "local",
          entry: serializeEntry(entry),
          enrich: null,
        },
        auth,
      );
    }

    // 2) 外网补全：中文先译成英文 lemma，再 enrich
    let lemma = qEn;
    const warnings: string[] = [];
    if (!lemma && qZh) {
      const translated = await translateZhToEn(qZh);
      if (translated) {
        lemma = translated;
      } else {
        warnings.push("中文未能译出英文单词，无法外网补全");
      }
    }

    if (!lemma) {
      return jsonWithSession(
        {
          query: queryRaw,
          fromAsr,
          found: false,
          source: "none",
          message: "词库中无此词，且无法外网补全",
          warnings,
          enrich: null,
        },
        auth,
      );
    }

    const enrich = await enrichWord(lemma);
    if (enrich.warnings?.length) warnings.push(...enrich.warnings);

    const hasContent = Boolean(enrich.glossZh || enrich.example || enrich.ipa);
    return jsonWithSession(
      {
        query: queryRaw,
        fromAsr,
        found: hasContent,
        source: hasContent ? "external" : "none",
        message: hasContent ? "词库无此词，已从外网补全（可加入词表）" : "未找到",
        warnings,
        entry: hasContent
          ? {
              id: null,
              word: enrich.word || lemma,
              glossZh: enrich.glossZh,
              ipa: enrich.ipa,
              pos: enrich.pos,
              example: enrich.example,
              phrases: enrich.phrases,
              related: enrich.related,
            }
          : null,
        enrich,
      },
      auth,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "查词失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
