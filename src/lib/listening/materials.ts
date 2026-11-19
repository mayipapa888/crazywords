/**
 * 磨耳朵素材库
 *
 * 只保留一套完整合集：初中英语听力磨耳朵 · 高频听力 9000 句（全 90 节）。
 * bvid 已通过 B 站官方接口核验（标题/时长/分P/UP 主）。
 * 播放使用 B 站官方播放器内嵌（player.bilibili.com），不下载、不转存，
 * 版权归原作者所有；失效时提供「在 B 站打开」兜底。
 */
export type ListeningMaterial = {
  bvid: string;
  title: string;
  up主: string;
  minutes: number;
  pages: number;
  tags: string[];
  subtitle: "中英双语" | "英文字幕";
  level: "初中" | "初中/小学高年级" | "初中/高中";
  note: string;
};

export const LISTENING_MATERIALS: ListeningMaterial[] = [
  {
    bvid: "BV1N5T76GEuN",
    title: "初中英语听力磨耳朵 · 高频听力 9000 句（全 90 节）",
    up主: "不难bn",
    minutes: 698,
    pages: 90,
    tags: ["分级听力", "中英发音", "每天一集"],
    subtitle: "中英双语",
    level: "初中",
    note: "从初级短句、填空练习到短对话、长句逐步推进；建议每天 1 集，约 8 分钟。",
  },
];

/** 当天素材（只有一套合集时不轮换） */
export function pickDailyMaterial(date = new Date()): ListeningMaterial {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return LISTENING_MATERIALS[dayOfYear % LISTENING_MATERIALS.length];
}

/** 建议的「今日第几集」：按年内天数轮转分 P */
export function pickDailyPart(totalPages: number, date = new Date()): number {
  if (totalPages <= 1) return 1;
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return (dayOfYear % totalPages) + 1;
}

/** B 站官方播放器嵌入地址（不自动播放，关弹幕，尽量高清） */
export function bilibiliEmbedUrl(bvid: string, page = 1): string {
  return `https://player.bilibili.com/player.html?bvid=${bvid}&page=${page}&high_quality=1&danmaku=0&autoplay=0`;
}

export function bilibiliWatchUrl(bvid: string, page = 1): string {
  return `https://www.bilibili.com/video/${bvid}/${page > 1 ? `?p=${page}` : ""}`;
}
