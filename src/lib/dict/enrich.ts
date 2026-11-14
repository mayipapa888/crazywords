export type EnrichResult = {
  word: string;
  glossZh: string | null;
  ipa: string | null;
  pos: string | null;
  example: string | null;
  phrases: string[];
  synonyms: string[];
  antonyms: string[];
  examples: string[];
  related: string[];
  incomplete: boolean;
  incompleteReasons: string[];
  sources: string[];
  warnings: string[];
};

type FreeDictSense = {
  definition?: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
};

type FreeDictMeaning = {
  partOfSpeech?: string;
  definitions?: FreeDictSense[];
  synonyms?: string[];
  antonyms?: string[];
};

type FreeDictPhonetic = { text?: string; audio?: string };

type FreeDictEntry = {
  word?: string;
  phonetic?: string;
  phonetics?: FreeDictPhonetic[];
  meanings?: FreeDictMeaning[];
};

type DictLookup = {
  ipa: string | null;
  pos: string | null;
  example: string | null;
  enGloss: string | null;
  related: string[];
  phrases: string[];
  synonyms: string[];
  antonyms: string[];
  examples: string[];
  warning?: string;
};

const MAX_SYNONYMS = 8;
const MAX_ANTONYMS = 8;
const MAX_EXAMPLES = 3;
const MAX_PHRASES = 6;

// 只认 headword + 小品词/介词 的搭配（如 give up / put up with / look forward to），避免凭空造词
const PHRASE_PARTICLES =
  "up|down|out|off|on|in|over|through|around|about|away|back|along|apart|together|forth|forward|by|to|with|for|into|onto|from|at|against|upon|under|after|before|across|beyond|past|round";
const PHRASE_PREPOSITIONS = "to|with|for|on|in|at|of|from|by|about|into|upon";

function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** 大小写不敏感去重，保留首次出现的写法，并排除 headword 本身 */
function uniqueTerms(values: Array<string | undefined>, limit: number, exclude?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const skip = exclude?.toLowerCase();
  for (const value of values) {
    if (!value) continue;
    const term = normalizeTerm(value);
    if (!term) continue;
    const key = term.toLowerCase();
    if (key === skip || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

/** 从英文释义里提取以该词开头的短语动词/常见搭配，提取不到就返回空数组 */
function extractPhrases(word: string, definitions: string[]): string[] {
  if (!word) return [];
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 只在定义句首、标点后或不定式 to 之后取搭配，避免把 "in order to" 误提成 "order to"
  const pattern = new RegExp(
    `(?:^|[.;:!?]\\s+|\\bto\\s+)(${escaped}\\s+(?:${PHRASE_PARTICLES})(?:\\s+(?:${PHRASE_PREPOSITIONS}))?)\\b`,
    "gi",
  );
  const found: string[] = [];
  for (const definition of definitions) {
    for (const match of definition.matchAll(pattern)) {
      const phrase = match[1];
      if (phrase) found.push(phrase.toLowerCase());
    }
  }
  return uniqueTerms(found, MAX_PHRASES);
}

function failedLookup(warning: string): DictLookup {
  return {
    ipa: null,
    pos: null,
    example: null,
    enGloss: null,
    related: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
    warning,
  };
}

async function fetchFreeDictionary(word: string): Promise<DictLookup | null> {
  const base = (process.env.DICTIONARY_API_BASE || "https://api.dictionaryapi.dev/api/v2/entries/en").replace(
    /\/$/,
    "",
  );
  const url = `${base}/${encodeURIComponent(word)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "CrazyWords/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      return failedLookup(`Free Dictionary API HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return failedLookup("Free Dictionary API 不可用（可能被拦截），已尝试回退");
    }
    const data = (await res.json()) as FreeDictEntry[] | { title?: string };
    if (!Array.isArray(data) || data.length === 0) return null;
    const entry = data[0];
    const ipa =
      entry.phonetic ||
      entry.phonetics?.map((p) => p.text).find(Boolean) ||
      null;
    const meanings = entry.meanings ?? [];
    const senses = meanings.flatMap((m) => m.definitions ?? []);
    const meaning = meanings[0];
    const pos = meaning?.partOfSpeech ? `${meaning.partOfSpeech}.` : null;
    // 保持既有行为：Free Dictionary 命中后按单词机翻中文（首义项常为生僻义，整句译文会过长）
    const enGloss = null;
    const examples = uniqueTerms(
      senses.map((s) => s.example),
      MAX_EXAMPLES,
    );
    const synonyms = uniqueTerms(
      [...meanings.flatMap((m) => m.synonyms ?? []), ...senses.flatMap((s) => s.synonyms ?? [])],
      MAX_SYNONYMS,
      word,
    );
    const antonyms = uniqueTerms(
      [...meanings.flatMap((m) => m.antonyms ?? []), ...senses.flatMap((s) => s.antonyms ?? [])],
      MAX_ANTONYMS,
      word,
    );
    const phrases = extractPhrases(
      word,
      senses.map((s) => s.definition).filter((d): d is string => Boolean(d)),
    );
    const example = examples[0] || null;
    const related = synonyms.slice(0, 5);
    return { ipa, pos, example, enGloss, related, phrases, synonyms, antonyms, examples };
  } catch (e) {
    return failedLookup(
      `Free Dictionary 请求失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Datamuse 的 sp="<word> *" 返回真实语料里以该词开头的常见搭配。
 * 只保留“单词 + 小品词/介词”的短语动词，避免把 give birth 这类名词搭配收进来。
 */
async function fetchDatamusePhrases(word: string): Promise<string[]> {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(`${word} *`)}&max=40`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ word?: string }>;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `^${escaped}\\s+(?:${PHRASE_PARTICLES})(?:\\s+(?:${PHRASE_PREPOSITIONS}))?$`,
      "i",
    );
    const candidates = data
      .map((item) => (item.word || "").toLowerCase())
      .filter((candidate) => Boolean(candidate) && pattern.test(candidate));
    return uniqueTerms(candidates, MAX_PHRASES);
  } catch {
    return [];
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
      synonyms: [],
      antonyms: [],
      examples: [],
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
  let phrases: string[] = [];
  let synonyms: string[] = [];
  let antonyms: string[] = [];
  let examples: string[] = [];

  const prefer = (process.env.DICTIONARY_PROVIDER || "auto").toLowerCase();
  const useFreeDict = prefer === "freedict" || prefer === "auto";
  const useDatamuse = prefer === "datamuse" || prefer === "auto";
  // 与词典请求并行：词典释义提取不到词组时，用 Datamuse 真实语料里的短语动词兜底
  const phrasePromise =
    useFreeDict || useDatamuse ? fetchDatamusePhrases(word) : Promise.resolve<string[]>([]);

  if (useFreeDict) {
    const fd = await fetchFreeDictionary(word);
    if (fd) {
      if (fd.warning) warnings.push(fd.warning);
      const hasContent =
        Boolean(fd.enGloss || fd.ipa || fd.pos) ||
        fd.synonyms.length > 0 ||
        fd.antonyms.length > 0 ||
        fd.examples.length > 0;
      if (hasContent) {
        ipa = fd.ipa;
        pos = fd.pos;
        example = fd.example;
        enGloss = fd.enGloss;
        related = fd.related;
        phrases = fd.phrases;
        synonyms = fd.synonyms;
        antonyms = fd.antonyms;
        examples = fd.examples;
        sources.push("freedictionary");
      }
    }
  }

  const dmPhrases = await phrasePromise;
  if (dmPhrases.length > 0) {
    phrases = uniqueTerms([...phrases, ...dmPhrases], MAX_PHRASES);
    sources.push("datamuse-phrases");
  }

  if (!enGloss && !ipa && !pos && useDatamuse) {
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
    phrases,
    synonyms,
    antonyms,
    examples,
    related,
    incomplete,
    incompleteReasons,
    sources,
    warnings,
  };
}
