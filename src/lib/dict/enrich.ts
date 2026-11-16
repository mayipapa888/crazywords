export type EnrichSense = {
  pos: string;
  defEn: string;
  defZh: string | null;
};

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
  senses: EnrichSense[];
  incomplete: boolean;
  incompleteReasons: string[];
  sources: string[];
  warnings: string[];
};

type RawSense = { pos: string; defEn: string };

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
  senses: RawSense[];
  warning?: string;
};

const MAX_SYNONYMS = 8;
const MAX_ANTONYMS = 8;
const MAX_EXAMPLES = 3;
const MAX_PHRASES = 6;
const MAX_SENSES = 4;
/** 每个词性最多缓存的候选义项；输出总数仍受 MAX_SENSES 限制 */
const MAX_SENSES_PER_POS = 4;
/** 第一轮每个词性优先取的高频义项数（词典 definition 顺序即常用度顺序） */
const MAX_SENSES_PRIMARY_PER_POS = 2;
const MAX_SENSE_GLOSS_SEGMENTS = 3;
const MAX_GLOSS_SEGMENTS = 15;

// 整体预算 ≤8s：词典/搭配并行，最多再等一轮翻译
const DICT_TIMEOUT_MS = 4000;
const DATAMUSE_TIMEOUT_MS = 3000;
const TRANSLATE_TIMEOUT_MS = 4000;

// 只认 headword + 小品词/介词 的搭配（如 give up / put up with / look forward to），避免凭空造词
const PHRASE_PARTICLES =
  "up|down|out|off|on|in|over|through|around|about|away|back|along|apart|together|forth|forward|by|to|with|for|into|onto|from|at|against|upon|under|after|before|across|beyond|past|round";
const PHRASE_PREPOSITIONS = "to|with|for|on|in|at|of|from|by|about|into|upon";

// 义项按词性优先级排列：动词最常用，其次是名词/形容词/副词
const POS_PRIORITY = ["verb", "noun", "adjective", "adverb"];

/** 生僻/历史/方言等标签的义项（外网释义常见 "(obsolete)"、"(archaic)" 前缀），聚合时丢弃 */
const RARE_DEFINITION_RE =
  /^\((?:obsolete|archaic|rare|dated|dialect|dialectal|nonstandard|historical|heraldry|nautical)\b/i;

/**
 * 常见繁体 → 简体单字映射（不引新依赖）。只覆盖词典释义里高频出现的字，
 * 用于把 MyMemory 可能返回的繁体译文统一成简体并合并重复表述。
 */
const TRAD_TO_SIMP = new Map<string, string>(
  (
    "續续 給给 與与 為为 這这 個个 們们 時时 會会 說说 對对 開开 關关 學学 習习 嗎吗 麼么 " +
    "樣样 種种 發发 現现 實实 際际 體体 經经 歷历 過过 還还 進进 運运 動动 語语 詞词 義义 " +
    "譯译 釋释 讀读 寫写 聽听 聲声 響响 處处 於于 並并 讓让 覺觉 從从 來来 後后 裡里 裏里 " +
    "內内 構构 應应 該该 將将 無无 數数 據据 點点 線线 麵面 麗丽 請请 謝谢 誰谁 遠远 邊边 " +
    "間间 問问 題题 聞闻 係系 繫系 聯联 絡络 網网 頁页 圖图 書书 車车 馬马 鳥鸟 魚鱼 龍龙 " +
    "門门 東东 長长 興兴 樂乐 愛爱 惡恶 驚惊 訝讶 難难 輕轻 鬆松 緊紧 張张 強强 豐丰 滿满 " +
    "節节 約约 範范 圍围 標标 準准 確确 認认 識识 記记 憶忆 訓训 練练 課课 試试 驗验 證证 " +
    "觀观 視视 觸触 維维 邏逻 輯辑 計计 統统 結结 組组 織织 機机 設设 執执 術术 藝艺 業业 " +
    "產产 質质 價价 錢钱 銀银 資资 負负 債债 財财 務务 稅税 費费 買买 賣卖 購购 貨货 輸输 " +
    "達达 遞递 郵邮 電电 話话 訊讯 號号 碼码 軟软 檔档 預预 刪删 複复 製制 貼贴 週周 總总 " +
    "幾几 雖虽 須须 變变 導导 階阶 驟骤 繼继 舊旧 壞坏 醜丑 乾干 淨净 髒脏 熱热 涼凉 濕湿 " +
    "寬宽 淺浅 細细 圓圆 鈍钝 銳锐 顯显 簡简 雜杂 許许 絕绝 較较 僅仅 擔担 憂忧 慮虑 奮奋 " +
    "傷伤 氣气 憤愤 餓饿 飽饱 脫脱 頭头 髮发 臉脸 腳脚 腎肾 膚肤 藥药 醫医 飲饮 飯饭 蟲虫 " +
    "樹树 葉叶 雲云 陽阳 鐘钟 錶表 萬万 億亿 兩两 雙双 貝贝 風风 飛飞 鄉乡 親亲 兒儿 孫孙 " +
    "婦妇 媽妈 爺爷 寶宝 寧宁 層层 屬属 屆届 峽峡 嶺岭 島岛 嶼屿 灣湾 師师 帶带 幫帮 幹干 " +
    "廣广 慶庆 庫库 廟庙 廠厂 廳厅 彈弹 歸归 當当 疊叠 礙碍 禮礼 禪禅 離离 穩稳 窮穷 筆笔 " +
    "籃篮 類类 糧粮 紀纪 純纯 紹绍 終终 繪绘 罰罚 羅罗 聖圣 膽胆 臨临 臺台 艦舰 蓮莲 蕭萧 " +
    "蘋苹 蘭兰 虛虚 蝦虾 衛卫 衝冲 補补 裝装 褲裤 見见 規规 覽览 訂订 討讨 託托 訪访 診诊 " +
    "註注 評评 詩诗 詳详 誤误 調调 談谈 論论 諮咨 諾诺 謀谋 講讲 護护 讚赞 貢贡 貧贫 販贩 " +
    "貪贪 責责 貴贵 貸贷 賀贺 賓宾 賜赐 賞赏 賠赔 賢贤 賤贱 賦赋 賬账 賭赌 賽赛 贈赠 贊赞 " +
    "贏赢 趙赵 趕赶 趨趋 蹟迹 軌轨 軒轩 軸轴 載载 輔辅 輛辆 輝辉 輪轮 轉转 轟轰 辦办 辭辞 " +
    "農农 連连 遊游 違违 遙遥 適适 選选 遷迁 遺遗 遼辽 邁迈 鑑鉴 針针 釣钓 鈴铃 鉛铅 銅铜 " +
    "鋼钢 錄录 錯错 錫锡 錦锦 鍵键 鐵铁 鑄铸 閃闪 閉闭 閒闲 閣阁 閱阅 闆板 陣阵 陰阴 陳陈 " +
    "陸陆 隊队 隨随 險险 隱隐 雞鸡 靜静 韓韩 頂顶 項项 順顺 頓顿 頒颁 領领 頸颈 頻频 顆颗 " +
    "額额 顏颜 願愿 顧顾 飾饰 飼饲 餅饼 養养 館馆 駐驻 駕驾 騎骑 鬥斗 鮮鲜 鳴鸣 鵬鹏 鹽盐 " +
    "麥麦 黃黄 黨党 齊齐 齒齿 龜龟"
  )
    .split(" ")
    .filter((pair) => pair.length >= 2)
    .map((pair) => [pair[0], pair[1]] as const),
);

function toSimplified(text: string): string {
  let out = "";
  for (const ch of text) out += TRAD_TO_SIMP.get(ch) ?? ch;
  return out;
}

function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** 保留多词短语词形：去掉标点、压缩空白，但保留内部空格 */
function normalizeDisplay(value: string): string {
  return value
    .trim()
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 大小写不敏感去重，保留首次出现的写法，并排除 headword 本身 */
function uniqueTerms(values: Array<string | undefined>, limit: number, exclude?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const skip = exclude ? normalizeTerm(exclude).toLowerCase() : undefined;
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
    senses: [],
    warning,
  };
}

function lookupHasContent(lookup: DictLookup | null): boolean {
  if (!lookup) return false;
  return Boolean(
    lookup.ipa ||
      lookup.pos ||
      lookup.senses.length ||
      lookup.synonyms.length ||
      lookup.antonyms.length ||
      lookup.examples.length ||
      lookup.enGloss,
  );
}

/** 去掉定义句首的语法标签（如 (ditransitive)），过滤 heading 占位义项 */
function cleanDefinition(raw: string): string | null {
  if (/^\(heading\)/i.test(raw.trim())) return null;
  let def = raw
    .replace(/^\([^)]{1,40}\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (def.length < 8) return null;
  if (def.length > 240) {
    const cut = def.slice(0, 240);
    const stop = Math.max(cut.lastIndexOf("; "), cut.lastIndexOf(". "));
    def = stop > 80 ? cut.slice(0, stop + 1).trim() : `${cut.trim()}…`;
  }
  return def;
}

/**
 * 单词语义聚合：按词性分组，实词优先（动词→名词→形容词→副词）。
 * 每个词性第一轮先取前 2 条高频 definition，总数不足 4 条时再从同一词性补足；
 * 生僻（obsolete/archaic 等）与重复 definition 直接丢弃，总数上限 4 条。
 * 只取词典真实存在的定义，不做任何补写。
 */
function aggregateSenses(meanings: FreeDictMeaning[]): RawSense[] {
  const groups = new Map<string, RawSense[]>();
  const seen = new Set<string>();

  for (const meaning of meanings) {
    const posRaw = (meaning.partOfSpeech || "").trim().toLowerCase();
    let bucket = groups.get(posRaw);
    if (!bucket) {
      bucket = [];
      groups.set(posRaw, bucket);
    }
    if (bucket.length >= MAX_SENSES_PER_POS) continue;
    for (const definition of meaning.definitions ?? []) {
      if (bucket.length >= MAX_SENSES_PER_POS) break;
      const rawDef = definition.definition?.trim();
      if (!rawDef) continue;
      // 生僻义项（obsolete/archaic/rare/dialect 等）不进入常用义项
      if (RARE_DEFINITION_RE.test(rawDef)) continue;
      const defEn = cleanDefinition(rawDef);
      if (!defEn) continue;
      const dedupeKey = defEn
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      bucket.push({ pos: posRaw ? `${posRaw}.` : "", defEn });
    }
  }

  const orderedPos: string[] = [];
  for (const pos of POS_PRIORITY) if (groups.has(pos)) orderedPos.push(pos);
  for (const pos of groups.keys()) if (!orderedPos.includes(pos)) orderedPos.push(pos);

  const out: RawSense[] = [];
  // 第一轮：按词性优先级各取前 2 条，保证动词/名词等实词的高频义项优先
  for (const pos of orderedPos) {
    for (const sense of (groups.get(pos) ?? []).slice(0, MAX_SENSES_PRIMARY_PER_POS)) {
      out.push(sense);
      if (out.length >= MAX_SENSES) return out;
    }
  }
  // 第二轮：义项不足 4 条时用同词性的后续义项补足（例如只有动词词性的词）
  for (const pos of orderedPos) {
    for (const sense of (groups.get(pos) ?? []).slice(MAX_SENSES_PRIMARY_PER_POS)) {
      out.push(sense);
      if (out.length >= MAX_SENSES) return out;
    }
  }
  return out;
}

/** 词性标签归一化：去掉结尾句点、统一小写，便于比较 "verb." 与 "verb" */
function normalizePos(pos: string | null | undefined): string {
  return (pos || "").trim().toLowerCase().replace(/\.$/, "");
}

/**
 * 多词短语只保留与中心词主要词性一致的义项，且最多 1 条。
 * 例：keep up with 的中心词 keep 主要词性是动词，就只留 1 条动词义项，
 * 丢掉「城堡主塔」「生活费」这类名词义项；中心词词性未知时也最多留 1 条。
 */
function pickPhraseSenses(senses: RawSense[], mainPos: string | null): RawSense[] {
  if (senses.length === 0) return [];
  const main = normalizePos(mainPos);
  if (main) {
    const matched = senses.filter((sense) => normalizePos(sense.pos) === main);
    if (matched.length > 0) return matched.slice(0, 1);
  }
  return senses.slice(0, 1);
}

async function fetchFreeDictionary(
  word: string,
  timeoutMs: number = DICT_TIMEOUT_MS,
): Promise<DictLookup | null> {
  const base = (process.env.DICTIONARY_API_BASE || "https://api.dictionaryapi.dev/api/v2/entries/en").replace(
    /\/$/,
    "",
  );
  const url = `${base}/${encodeURIComponent(word)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "CrazyWords/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
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
    const allSenses = meanings.flatMap((m) => m.definitions ?? []);
    const senses = aggregateSenses(meanings);
    const pos = senses[0]?.pos ?? (meanings[0]?.partOfSpeech ? `${meanings[0].partOfSpeech}.` : null);
    // 保持既有行为：Free Dictionary 命中后按释义机翻中文（见 enrichWord 的义项翻译）
    const enGloss = null;
    const examples = uniqueTerms(
      allSenses.map((s) => s.example),
      MAX_EXAMPLES,
    );
    const synonyms = uniqueTerms(
      [...meanings.flatMap((m) => m.synonyms ?? []), ...allSenses.flatMap((s) => s.synonyms ?? [])],
      MAX_SYNONYMS,
      word,
    );
    const antonyms = uniqueTerms(
      [...meanings.flatMap((m) => m.antonyms ?? []), ...allSenses.flatMap((s) => s.antonyms ?? [])],
      MAX_ANTONYMS,
      word,
    );
    const phrases = extractPhrases(
      word,
      allSenses.map((s) => s.definition).filter((d): d is string => Boolean(d)),
    );
    const example = examples[0] || null;
    const related = synonyms.slice(0, 5);
    return { ipa, pos, example, enGloss, related, phrases, synonyms, antonyms, examples, senses };
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
    const res = await fetch(url, { signal: AbortSignal.timeout(DATAMUSE_TIMEOUT_MS) });
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

/** 用 Datamuse 的精确拼写匹配确认整条短语是否是真实存在的常见搭配 */
async function fetchDatamusePhraseCommon(phrase: string): Promise<boolean> {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(phrase)}&max=5`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DATAMUSE_TIMEOUT_MS) });
    if (!res.ok) return false;
    const data = (await res.json()) as Array<{ word?: string }>;
    const target = phrase.toLowerCase();
    return data.some((item) => (item.word || "").trim().toLowerCase() === target);
  } catch {
    return false;
  }
}

type DatamuseLookup = {
  ipa: string | null;
  pos: string | null;
  example: string | null;
  enGloss: string | null;
  related: string[];
};

async function fetchDatamuse(word: string): Promise<DatamuseLookup | null> {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dpfr&max=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DATAMUSE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      word?: string;
      tags?: string[];
      defs?: string[];
    }>;
    const hit = data[0];
    if (!hit) return null;
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

async function translateToZh(
  text: string,
  timeoutMs: number = TRANSLATE_TIMEOUT_MS,
): Promise<{ zh: string | null; warning?: string }> {
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
      const res = await fetch(u.toString(), { signal: AbortSignal.timeout(timeoutMs) });
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
 * 译文清洗：去 [拼音]/【标注】/英文括注，繁体转简体，拆分重复近义表述后去重。
 * 例："延續 延续 [yan2 xu4]" → "延续"
 */
function cleanZhGloss(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/【[^】]*】/g, " ")
    .replace(/[（(][A-Za-zÀ-ÖØ-öø-ÿĀ-ž0-9\s.,;:'"!?\/\\-]*[）)]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = stripped.split(/[\s；;、/|]+/);
  const out: string[] = [];
  for (const part of parts) {
    const simplified = toSimplified(part)
      .replace(/^[\s,，.。:：;；!?！？、·\-—]+/, "")
      .replace(/[\s,，.。:：;；!?！？、·\-—]+$/, "")
      .trim();
    if (!simplified) continue;
    if (!/[\u4e00-\u9fff]/.test(simplified)) continue;
    const key = simplified.replace(/\s+/g, "");
    if (!key) continue;
    if (out.some((item) => item.replace(/\s+/g, "") === key)) continue;
    out.push(simplified);
    if (out.length >= MAX_SENSE_GLOSS_SEGMENTS) break;
  }
  return out.length ? out.join("；") : null;
}

/** 把各义项中文译文按 ； 拼接，跨义项去重，保留完整多义 */
function joinSenseGlosses(senses: EnrichSense[]): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const sense of senses) {
    if (!sense.defZh) continue;
    for (const piece of sense.defZh.split("；")) {
      const clean = piece.trim();
      if (!clean) continue;
      const key = clean.replace(/[\s，,。.：:、]/g, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      parts.push(clean);
      if (parts.length >= MAX_GLOSS_SEGMENTS) return parts.join("；");
    }
  }
  return parts.length ? parts.join("；") : null;
}

/** 翻译全部失败时的降级：英文 definition 截断 */
function truncateEn(text: string | null | undefined, max = 90): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = cut.lastIndexOf(" ");
  return `${(stop > 40 ? cut.slice(0, stop) : cut).trim()}…`;
}

/** 并行翻译最多 4 条义项（短语最多 1 条），单条失败只跳过该条 */
async function translateSenses(
  rawSenses: RawSense[],
): Promise<{ senses: EnrichSense[]; warnings: string[]; okCount: number }> {
  if (rawSenses.length === 0) return { senses: [], warnings: [], okCount: 0 };
  const settled = await Promise.all(
    rawSenses.map(async (sense) => {
      const tr = await translateToZh(sense.defEn, TRANSLATE_TIMEOUT_MS);
      const defZh = tr.zh ? cleanZhGloss(tr.zh) : null;
      return {
        sense: { pos: sense.pos, defEn: sense.defEn, defZh },
        warning: tr.warning,
        ok: Boolean(defZh),
      };
    }),
  );
  const okCount = settled.filter((item) => item.ok).length;
  const warnings: string[] = [];
  if (okCount < settled.length) {
    const issue = settled.find((item) => !item.ok && item.warning)?.warning;
    if (okCount === 0) {
      warnings.push(issue || "义项翻译失败，未能获得中文释义");
    } else {
      warnings.push(
        `部分义项翻译失败（${okCount}/${settled.length}）${issue ? `：${issue}` : ""}`,
      );
    }
  }
  return { senses: settled.map((item) => item.sense), warnings, okCount };
}

function failureResult(
  word: string,
  reasons: string[],
  warnings: string[],
  sources: string[],
): EnrichResult {
  return {
    word,
    glossZh: null,
    ipa: null,
    pos: null,
    example: null,
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
    related: [],
    senses: [],
    incomplete: true,
    incompleteReasons: reasons,
    sources,
    warnings: [...new Set(warnings)],
  };
}

/**
 * 自动补全词条字段：
 * 1) 单词：Free Dictionary API（可 DICTIONARY_API_BASE 覆盖）聚合多义项，失败回退 Datamuse
 * 2) 短语：整条词典尝试 → 中心词词典条目 → Datamuse 整串搭配证据，中心词义项放 senses
 * 3) 英文释义/短语 → MyMemory 译中文（可关），逐条失败降级不抛错
 */
export async function enrichWord(rawWord: string): Promise<EnrichResult> {
  const display = normalizeDisplay(rawWord);
  const word = display.toLowerCase();
  const warnings: string[] = [];
  const sources: string[] = [];

  if (!display) {
    return failureResult("", ["缺少单词"], ["请输入英文单词"], sources);
  }

  const isPhrase = word.includes(" ");
  const headword = isPhrase ? word.split(" ")[0] : word;
  const prefer = (process.env.DICTIONARY_PROVIDER || "auto").toLowerCase();
  const useFreeDict = prefer === "freedict" || prefer === "auto";
  const useDatamuse = prefer === "datamuse" || prefer === "auto";

  let ipa: string | null = null;
  let pos: string | null = null;
  let example: string | null = null;
  let related: string[] = [];
  let phrases: string[] = [];
  let synonyms: string[] = [];
  let antonyms: string[] = [];
  let examples: string[] = [];
  let rawSenses: RawSense[] = [];
  let translatedSenses: EnrichSense[] = [];
  let glossZh: string | null = null;

  if (isPhrase) {
    // 整串词典 + 中心词词典 + Datamuse 搭配证据并行；整串大概率 404，失败直接降级
    const [wholeLookup, headLookup, dmPhrases, phraseCommon] = await Promise.all([
      useFreeDict ? fetchFreeDictionary(word, DICT_TIMEOUT_MS) : Promise.resolve(null),
      useFreeDict ? fetchFreeDictionary(headword, DICT_TIMEOUT_MS) : Promise.resolve(null),
      useDatamuse ? fetchDatamusePhrases(headword) : Promise.resolve<string[]>([]),
      useDatamuse ? fetchDatamusePhraseCommon(word) : Promise.resolve(false),
    ]);

    const wholePhraseFound = lookupHasContent(wholeLookup);
    const headwordFound = lookupHasContent(headLookup);
    if (wholeLookup?.warning) warnings.push(wholeLookup.warning);
    if (headLookup?.warning) warnings.push(headLookup.warning);
    if (wholePhraseFound) sources.push("freedictionary-phrase");
    if (headwordFound) sources.push("freedictionary-headword");

    if (!wholePhraseFound && !headwordFound && !phraseCommon) {
      return failureResult(
        display,
        ["词典与 Datamuse 均无该短语记录"],
        [`未找到短语「${display}」：词典无整条记录，中心词「${headword}」无条目，Datamuse 无搭配证据`],
        sources,
      );
    }

    // 中心词条目是基础信息（含音标）；整条词条命中时再补齐/合并
    const base = headwordFound ? headLookup : wholeLookup;
    if (base) {
      ipa = base.ipa;
      pos = base.pos;
      example = base.example;
      related = base.related;
      synonyms = base.synonyms;
      antonyms = base.antonyms;
      examples = base.examples;
      phrases = base.phrases;
    }
    if (wholePhraseFound && headwordFound && wholeLookup) {
      ipa = ipa || wholeLookup.ipa;
      example = wholeLookup.example || example;
      synonyms = uniqueTerms([...synonyms, ...wholeLookup.synonyms], MAX_SYNONYMS, word);
      antonyms = uniqueTerms([...antonyms, ...wholeLookup.antonyms], MAX_ANTONYMS, word);
      examples = uniqueTerms([...examples, ...wholeLookup.examples], MAX_EXAMPLES);
      phrases = uniqueTerms([...phrases, ...wholeLookup.phrases], MAX_PHRASES);
    }
    // 中心词义项只作补充：只保留与中心词主要词性一致的 1 条，
    // 避免把「城堡主塔」（名词）这类与 keep（动词）不一致的义项带进短语结果
    if (headwordFound) {
      rawSenses = pickPhraseSenses(headLookup?.senses ?? [], headLookup?.pos ?? null);
    } else {
      // 整条短语自身命中的词条没有中心词词性可比对，同样最多留 1 条
      rawSenses = (base?.senses ?? []).slice(0, 1);
    }

    if (phraseCommon) {
      sources.push("datamuse-phrase");
      phrases = uniqueTerms([display, ...phrases], MAX_PHRASES);
    }
    if (dmPhrases.length > 0) {
      phrases = uniqueTerms([...phrases, ...dmPhrases], MAX_PHRASES);
      sources.push("datamuse-phrases");
    }

    // 整条短语翻译 + 中心词义项翻译并行，避免串行超预算
    const [senseResult, phraseTr] = await Promise.all([
      translateSenses(rawSenses),
      translateToZh(word, TRANSLATE_TIMEOUT_MS),
    ]);
    warnings.push(...senseResult.warnings);
    const phraseZh = phraseTr.zh ? cleanZhGloss(phraseTr.zh) : null;
    if (phraseZh) sources.push("mymemory-phrase");
    else if (phraseTr.warning) warnings.push(phraseTr.warning);

    // 不编造：只有整条词条、Datamuse 搭配证据或“中心词存在 + 整条短语可译”才认
    const accepted = wholePhraseFound || phraseCommon || (headwordFound && Boolean(phraseZh));
    if (!accepted) {
      return failureResult(
        display,
        ["无法确认该短语的整条释义"],
        [`未能确认短语「${display}」：无整条词条/搭配证据，且整条短语翻译失败，未编造释义`],
        sources,
      );
    }

    glossZh = phraseZh ?? truncateEn(rawSenses[0]?.defEn, 80);
    if (!phraseZh) {
      warnings.push(
        glossZh
          ? "整条短语翻译失败，中文释义退化为中心词英文释义截断"
          : "未能获得该短语的中文释义，请手填",
      );
    }

    const incompleteReasons: string[] = [];
    if (!glossZh) incompleteReasons.push("缺中文释义");
    if (!example) incompleteReasons.push("缺例句");
    return {
      word: display,
      glossZh,
      ipa,
      pos,
      example,
      phrases,
      synonyms,
      antonyms,
      examples,
      related,
      senses: senseResult.senses,
      incomplete: !glossZh && !example,
      incompleteReasons,
      sources,
      warnings: [...new Set(warnings)],
    };
  }

  // 单词：Datamuse 搭配与兜底请求先发，和词典并行，控制整体耗时
  const phrasePromise = useDatamuse ? fetchDatamusePhrases(word) : Promise.resolve<string[]>([]);
  const datamuseFallbackPromise = useDatamuse
    ? fetchDatamuse(word)
    : Promise.resolve<DatamuseLookup | null>(null);

  const fd = useFreeDict ? await fetchFreeDictionary(word, DICT_TIMEOUT_MS) : null;
  if (fd?.warning) warnings.push(fd.warning);

  const fdContent = lookupHasContent(fd);
  if (fdContent && fd) {
    ipa = fd.ipa;
    pos = fd.pos;
    example = fd.example;
    related = fd.related;
    phrases = fd.phrases;
    synonyms = fd.synonyms;
    antonyms = fd.antonyms;
    examples = fd.examples;
    rawSenses = fd.senses;
    sources.push("freedictionary");
  }

  const dmPhrases = await phrasePromise;
  if (dmPhrases.length > 0) {
    phrases = uniqueTerms([...phrases, ...dmPhrases], MAX_PHRASES);
    sources.push("datamuse-phrases");
  }

  if (rawSenses.length > 0) {
    const senseResult = await translateSenses(rawSenses);
    translatedSenses = senseResult.senses;
    warnings.push(...senseResult.warnings);
    glossZh = joinSenseGlosses(senseResult.senses);
    if (glossZh) {
      sources.push("mymemory");
    } else {
      const fallback = truncateEn(rawSenses[0]?.defEn, 100);
      if (fallback) {
        glossZh = fallback;
        warnings.push("义项翻译失败，中文释义退化为英文释义截断");
      }
    }
  }

  if (!fdContent) {
    const dm = await datamuseFallbackPromise;
    if (dm && (dm.enGloss || dm.ipa || dm.pos)) {
      ipa = ipa || dm.ipa;
      pos = pos || dm.pos;
      example = example || dm.example;
      related = related.length ? related : dm.related;
      sources.push("datamuse");
      if (!glossZh && dm.enGloss) {
        const tr = await translateToZh(dm.enGloss, TRANSLATE_TIMEOUT_MS);
        if (tr.warning) warnings.push(tr.warning);
        glossZh = tr.zh ? cleanZhGloss(tr.zh) : null;
        if (glossZh) sources.push("mymemory");
      }
    } else if (!sources.length) {
      warnings.push("词典未找到该词，请手填字段");
    }
  }

  if (!glossZh && rawSenses.length === 0) {
    // 无英文释义时，尝试直接译单词（弱兜底）
    const tr = await translateToZh(word, TRANSLATE_TIMEOUT_MS);
    if (tr.zh) {
      glossZh = cleanZhGloss(tr.zh);
      if (glossZh) {
        sources.push("mymemory-word");
        warnings.push("仅根据单词译出中文，建议核对");
      }
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
    senses: translatedSenses,
    incomplete,
    incompleteReasons,
    sources,
    warnings: [...new Set(warnings)],
  };
}
