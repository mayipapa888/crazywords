export type EnrichResult = {
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string[];
  related: string[];
  incomplete: boolean;
  incompleteReasons: string[];
  sources: string[];
  warnings: string[];
};

type FreeDictSense = {
  definitions?: string[];
  example?: string;
  synonyms?: string[];
};

type FreeDictMeaning = {
  partOfSpeech?: string;
  definitions?: FreeDictSense[];
};

type FreeDictPhonetic = { text?: string; audio?: string };

type FreeDictEntry = {
  word?: string;
  phonetic?: string;
  phonetics?: FreeDictPhonetic[];
  meanings?: FreeDictMeaning[];
};

async function fetchFreeDictionary(word: string): Promise<{
  ipa: string | null;
  pos: string | null;
  example: string | null;
  enGloss: string | null;
  related: string[];
  warning?: string;
} | null> {
  const base = (process.env.DICTIONARY_API_BASE || "https://api.dictionaryapi.dev/api/v2/entries/en").replace(
    /\/$/,
    "",
  );
  const url = `${base}/${encodeURIComponent(word)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "CrazyWords/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      return {
        ipa: null,
        pos: null,
        example: null,
        enGloss: null,
        related: [],
        warning: `Free Dictionary API HTTP ${res.status}`,
      };
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return {
        ipa: null,
        pos: null,
        example: null,
        enGloss: null,
        related: [],
        warning: "Free Dictionary API 不可用（可能被拦截），已尝试回退",
      };
    }
    const data = (await res.json()) as FreeDictEntry[] | { title?: string };
    if (!Array.isArray(data) || data.length === 0) return null;
    const entry = data[0];
    const ipa =
      entry.phonetic ||
      entry.phonetics?.map((p) => p.text).find(Boolean) ||
      null;
    const meaning = entry.meanings?.[0];
    const sense = meaning?.definitions?.[0];
    const pos = meaning?.partOfSpeech ? `${meaning.partOfSpeech}.` : null;
    const enGloss = sense?.definitions?.[0] || null;
    const example = sense?.example || null;
    const related = sense?.synonyms?.slice(0, 5) || [];
    return { ipa, pos, example, enGloss, related };
  } catch (e) {
    return {
      ipa: null,
      pos: null,
      example: null,
      enGloss: null,
      related: [],
      warning: `Free Dictionary 请求失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function fetchDatamuse(word: string): Promise<{
  ipa: string | null;
  pos: string | null;
  example: string | null;
  enGloss: string | null;
  related: string[];
} | null> {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dpfr&max=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      word?: string;
      tags?: string[];
      defs?: string[];
    }>;
    const hit = data[0];
    if (!hit || hit.word?.toLowerCase() !== word.toLowerCase()) {
      // sp= exact often returns the word; if not exact, still use if close
      if (!hit) return null;
    }
    const tags = hit.tags || [];
    const pron = tags.find((t) => t.startsWith("pron:"));
    const ipa = pron ? `/${pron.slice(5).trim()}/` : null;
    const posTag = tags.find((t) => ["n", "v", "adj", "adv"].includes(t));
    const posMap: Record<string, string> = { n: "n.", v: "v.", adj: "adj.", adv: "adv." };
    const pos = posTag ? posMap[posTag] || `${posTag}.` : null;
    const defRaw = hit.defs?.[0] || "";
    // defs like "v\tTo give up..."
    const tab = defRaw.indexOf("\t");
    const enGloss = tab >= 0 ? defRaw.slice(tab + 1).trim() : defRaw.trim() || null;
    return { ipa, pos, example: null, enGloss, related: [] };
  } catch {
    return null;
  }
}

async function translateToZh(text: string): Promise<{ zh: string | null; warning?: string }> {
  const provider = (process.env.TRANSLATE_PROVIDER || "mymemory").toLowerCase();
  if (provider === "none" || provider === "off") {
    return { zh: null, warning: "未启用翻译（TRANSLATE_PROVIDER=none），请手填中文释义" };
  }
  if (!text.trim()) return { zh: null };

  if (provider === "mymemory") {
    const email = process.env.MYMEMORY_EMAIL?.trim();
    const u = new URL("https://api.mymemory.translated.net/get");
    u.searchParams.set("q", text.slice(0, 450));
    u.searchParams.set("langpair", "en|zh-CN");
    if (email) u.searchParams.set("de", email);
    try {
      const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        return { zh: null, warning: `MyMemory 翻译 HTTP ${res.status}` };
      }
      const data = (await res.json()) as {
        responseData?: { translatedText?: string };
        responseStatus?: number;
        quotaFinished?: boolean;
      };
      if (data.quotaFinished) {
        return { zh: null, warning: "MyMemory 额度用尽，请手填中文或设置 MYMEMORY_EMAIL" };
      }
      const zh = data.responseData?.translatedText?.trim() || null;
      if (!zh || zh.toLowerCase() === text.toLowerCase()) {
        return { zh: null, warning: "翻译未返回可用中文，请手填 gloss_zh" };
      }
      return { zh };
    } catch (e) {
      return {
        zh: null,
        warning: `翻译失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  return {
    zh: null,
    warning: `未知 TRANSLATE_PROVIDER=${provider}，请使用 mymemory 或 none`,
  };
}

/**
 * 自动补全词条字段：
 * 1) Free Dictionary API（可 DICTIONARY_API_BASE 覆盖）
 * 2) 失败则回退 Datamuse
 * 3) 英文释义 → MyMemory 译中文（可关）
 */
export async function enrichWord(rawWord: string): Promise<EnrichResult> {
  const word = rawWord.trim().toLowerCase().replace(/[^\w'-]/g, "");
  const warnings: string[] = [];
  const sources: string[] = [];

  if (!word) {
    return {
      word: "",
      glossZh: null,
      ipa: null,
      pos: null,
      example: null,
      phrases: [],
      related: [],
      incomplete: true,
      incompleteReasons: ["缺少单词"],
      sources,
      warnings: ["请输入英文单词"],
    };
  }

  let ipa: string | null = null;
  let pos: string | null = null;
  let example: string | null = null;
  let enGloss: string | null = null;
  let related: string[] = [];

  const prefer = (process.env.DICTIONARY_PROVIDER || "auto").toLowerCase();

  if (prefer === "freedict" || prefer === "auto") {
    const fd = await fetchFreeDictionary(word);
    if (fd) {
      if (fd.warning) warnings.push(fd.warning);
      if (fd.enGloss || fd.ipa || fd.pos) {
        ipa = fd.ipa;
        pos = fd.pos;
        example = fd.example;
        enGloss = fd.enGloss;
        related = fd.related;
        sources.push("freedictionary");
      }
    }
  }

  if ((!enGloss && !ipa && !pos) && (prefer === "datamuse" || prefer === "auto")) {
    const dm = await fetchDatamuse(word);
    if (dm && (dm.enGloss || dm.ipa || dm.pos)) {
      ipa = ipa || dm.ipa;
      pos = pos || dm.pos;
      example = example || dm.example;
      enGloss = enGloss || dm.enGloss;
      related = related.length ? related : dm.related;
      sources.push("datamuse");
    } else if (!sources.length) {
      warnings.push("词典未找到该词，请手填字段");
    }
  }

  let glossZh: string | null = null;
  if (enGloss) {
    const tr = await translateToZh(enGloss);
    glossZh = tr.zh;
    if (tr.warning) warnings.push(tr.warning);
    if (tr.zh) sources.push("mymemory");
  } else {
    // 无英文释义时，尝试直接译单词（弱兜底）
    const tr = await translateToZh(word);
    glossZh = tr.zh;
    if (tr.zh) {
      sources.push("mymemory-word");
      warnings.push("仅根据单词译出中文，建议核对");
    } else if (tr.warning) {
      warnings.push(tr.warning);
    }
  }

  const incompleteReasons: string[] = [];
  if (!glossZh) incompleteReasons.push("缺中文释义");
  if (!example) incompleteReasons.push("缺例句");
  const incomplete = !glossZh && !example;

  return {
    word,
    glossZh,
    ipa,
    pos,
    example,
    phrases: [],
    related,
    incomplete,
    incompleteReasons,
    sources,
    warnings,
  };
}
