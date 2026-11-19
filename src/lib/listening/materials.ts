/**
 * 磨耳朵素材库（初中级）
 *
 * 全部通过 B 站官方接口核验过 bvid 有效性（标题/时长/UP 主）。
 * 播放一律使用 B 站官方播放器内嵌（player.bilibili.com），不下载、不转存，
 * 版权归原作者所有；失效时提供「在 B 站打开」兜底。
 */
export type ListeningMaterial = {
  bvid: string;
  title: string;
  up主: string;
  minutes: number;
  pages: number;
  tags: string[];
  /** 字幕情况 */
  subtitle: "中英双语" | "英文字幕";
  level: "初中" | "初中/小学高年级" | "初中/高中";
  note: string;
};

export const LISTENING_MATERIALS: ListeningMaterial[] = [
  {
    bvid: "BV1ejyGBKEsV",
    title: "10 个听力搞定初中英语 2200 词（五）",
    up主: "千寻英语",
    minutes: 23,
    pages: 1,
    tags: ["初中词汇", "短对话", "每日一集"],
    subtitle: "中英双语",
    level: "初中",
    note: "只含初中单词，原生口音，适合每天 20 分钟精听。",
  },
  {
    bvid: "BV19YcczkEPk",
    title: "Amazing China 美丽中国 · 沉浸式双语字幕",
    up主: "辉仔学习交流区",
    minutes: 95,
    pages: 1,
    tags: ["纪录片", "英音", "语速适中"],
    subtitle: "中英双语",
    level: "初中/小学高年级",
    note: "纯正英音 + 双语字幕，讲中国故事，词汇不难、画面友好。",
  },
  {
    bvid: "BV1wQKge6EJ4",
    title: "2025 全年 BBC Newsround 英国儿童新闻",
    up主: "蕾梦拉童学社",
    minutes: 500,
    pages: 67,
    tags: ["BBC", "新闻", "每天 6 分钟"],
    subtitle: "中英双语",
    level: "初中",
    note: "专供 6–12 岁，语速偏慢、句子简短，一天一集最合适。",
  },
  {
    bvid: "BV1Rm421g7yT",
    title: "看迪士尼电影学英语（43 集合集）",
    up主: "YouTube英语听说",
    minutes: 519,
    pages: 22,
    tags: ["电影", "口语", "跟读"],
    subtitle: "中英双语",
    level: "初中/高中",
    note: "电影原声片段 + 讲解，适合听译和跟读，选感兴趣的电影看。",
  },
  {
    bvid: "BV17TBUB4EGK",
    title: "全 66 节 初中英语听力磨耳朵 · 高频 9000 句",
    up主: "学习不好肝来凑",
    minutes: 603,
    pages: 66,
    tags: ["分级听力", "短句", "填空练习"],
    subtitle: "中英双语",
    level: "初中",
    note: "从短句到短对话再到填空，阶梯式推进，适合系统刷。",
  },
  {
    bvid: "BV13osZ62EcC",
    title: "BBC Newsround 字幕版 + 无字幕版（可进阶）",
    up主: "海上小甜橙",
    minutes: 37,
    pages: 8,
    tags: ["BBC", "无字幕挑战", "进阶"],
    subtitle: "英文字幕",
    level: "初中/高中",
    note: "同一期有字幕版与无字幕版，先看字幕再过一遍无字幕。",
  },
];

/** 按日期取当天素材：同一天始终是同一条，跨天自动轮换 */
export function pickDailyMaterial(date = new Date()): ListeningMaterial {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return LISTENING_MATERIALS[dayOfYear % LISTENING_MATERIALS.length];
}

/** B 站官方播放器嵌入地址（不自动播放，关弹幕，尽量高清） */
export function bilibiliEmbedUrl(bvid: string): string {
  return `https://player.bilibili.com/player.html?bvid=${bvid}&page=1&high_quality=1&danmaku=0&autoplay=0`;
}

export function bilibiliWatchUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${bvid}/`;
}
