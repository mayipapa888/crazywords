import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { enrichWord } from "@/lib/dict/enrich";

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const word = new URL(req.url).searchParams.get("word") || "";
    if (!word.trim()) {
      return NextResponse.json({ error: "缺少 word 参数" }, { status: 400 });
    }
    const result = await enrichWord(word);
    return jsonWithSession(result, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const word = String(body.word || "").trim();
    if (!word) {
      return NextResponse.json({ error: "缺少 word" }, { status: 400 });
    }
    const result = await enrichWord(word);
    return jsonWithSession(result, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
