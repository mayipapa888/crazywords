import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { parseWordCsv } from "@/lib/csv-import";
import { upsertEntriesForUser } from "@/lib/word-upsert";

const PRESETS: Record<string, { file: string; listName: string }> = {
  "shanghai-2026": {
    file: "samples/shanghai-zhongkao-2026.csv",
    listName: "上海初中考纲 2026",
  },
  sample: {
    file: "samples/words.sample.csv",
    listName: "默认样例词表",
  },
};

export async function GET() {
  return NextResponse.json({
    presets: Object.entries(PRESETS).map(([id, p]) => ({
      id,
      listName: p.listName,
      file: p.file,
    })),
  });
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const id = String(body.preset || body.id || "shanghai-2026");
    const preset = PRESETS[id];
    if (!preset) {
      return NextResponse.json({ error: `未知预设：${id}` }, { status: 400 });
    }
    const csvPath = path.join(process.cwd(), preset.file);
    if (!fs.existsSync(csvPath)) {
      return NextResponse.json({ error: `缺少数据文件 ${preset.file}` }, { status: 404 });
    }
    const text = fs.readFileSync(csvPath, "utf8");
    const { entries, errors } = parseWordCsv(text);
    if (!entries.length) {
      return NextResponse.json({ error: "预设词表为空", errors }, { status: 400 });
    }
    const result = await upsertEntriesForUser({
      userId: auth.user.id,
      listName: preset.listName,
      source: `preset:${id}`,
      entries,
    });
    return jsonWithSession({ ...result, errors, preset: id }, auth);
  } catch (e) {
    return errorJson(e, 401);
  }
}
