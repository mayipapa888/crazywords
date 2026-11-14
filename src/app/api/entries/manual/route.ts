import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { toJsonArray } from "@/lib/json";
import { upsertEntriesForUser } from "@/lib/word-upsert";
import { entryCompleteness } from "@/lib/json";

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json();
    const word = String(body.word || "").trim();
    if (!word) {
      return NextResponse.json({ error: "单词（word）必填" }, { status: 400 });
    }

    const entry = {
      word,
      glossZh: body.glossZh?.trim() || null,
      ipa: body.ipa?.trim() || null,
      pos: body.pos?.trim() || null,
      example: body.example?.trim() || null,
      phrases: toJsonArray(
        Array.isArray(body.phrases)
          ? body.phrases
          : String(body.phrases || "")
              .split("|")
              .map((s: string) => s.trim())
              .filter(Boolean),
      ),
      related: toJsonArray(
        Array.isArray(body.related)
          ? body.related
          : String(body.related || "")
              .split("|")
              .map((s: string) => s.trim())
              .filter(Boolean),
      ),
    };

    const result = await upsertEntriesForUser({
      userId: auth.user.id,
      listId: body.listId || undefined,
      listName: body.listName || "手工导入",
      source: "manual",
      entries: [entry],
    });

    const { incomplete, reasons } = entryCompleteness(entry);

    return jsonWithSession(
      {
        ...result,
        entry,
        incomplete,
        incompleteReasons: reasons,
        overwritten: result.updated > 0,
      },
      auth,
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    if (msg === "需要登录") return errorJson(e, 401);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
