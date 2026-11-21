"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useBattle, type FeedItem } from "@/components/battle/useBattle";
import type { BattleHud, BattleResult, FeedTone } from "@/components/battle/engine";

/* -------------------------------------------------------------------------- */
/* 常量与工具                                                                   */
/* -------------------------------------------------------------------------- */

const ARMOR_OPTIONS = [
  { value: 0, label: "无甲", detail: "移速 245", hint: "全凭走位" },
  { value: 50, label: "轻甲", detail: "护甲 50 · 移速 232", hint: "攻守均衡" },
  { value: 100, label: "重甲", detail: "护甲 100 · 移速 220", hint: "硬扛枪线" },
] as const;

const FEED_TONE_CLASS: Record<FeedTone, string> = {
  "player-kill": "border-emerald-300/30 bg-emerald-500/15 text-emerald-100",
  "player-death": "border-rose-300/40 bg-rose-500/20 text-rose-100",
  zone: "border-fuchsia-300/30 bg-fuchsia-500/15 text-fuchsia-100",
  other: "border-white/10 bg-white/5 text-white/70",
  loot: "border-amber-300/40 bg-amber-400/20 text-amber-100",
};

/** 页面外层阶段：loading = 正在扣券；finished = 已结束并进入结算 */
type PagePhase = "loading" | "no-ticket" | "ready" | "playing" | "finished";

/** 战绩上传状态：idle 只会出现在没有进入结算的瞬间 */
type FinishState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done"; expGained: number; placementExp: number; killsExp: number }
  | { status: "error"; message: string };

type EnterOutcome =
  | { kind: "ok"; recordId: string; tickets: number | null }
  | { kind: "no-ticket" }
  | { kind: "error"; message: string };

type FinishOutcome =
  | {
      kind: "ok";
      expGained: number;
      placementExp: number;
      killsExp: number;
      tickets: number | null;
    }
  | { kind: "error"; message: string };

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** 读取 JSON 对象；非 JSON / 非对象一律视为空对象，避免把解析错误抛给调用方 */
async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readApiError(data: Record<string, unknown>, status: number): string {
  const message = data.error;
  if (typeof message === "string" && message.trim()) return message;
  return `请求失败（HTTP ${status}）`;
}

/**
 * 进入战场（扣 1 张券）。契约：
 * - 200 { ok: true, recordId, tickets }
 * - 409 { error, tickets: 0 }
 */
async function requestEnter(): Promise<EnterOutcome> {
  try {
    const response = await fetch("/api/pet/battle/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const data = await readJsonObject(response);

    if (response.status === 409) return { kind: "no-ticket" };
    if (!response.ok || data.ok !== true) {
      return { kind: "error", message: readApiError(data, response.status) };
    }

    const recordId = typeof data.recordId === "string" ? data.recordId : "";
    if (!recordId) return { kind: "error", message: "进入接口未返回本局凭证，请重试" };

    return {
      kind: "ok",
      recordId,
      tickets: typeof data.tickets === "number" ? data.tickets : null,
    };
  } catch {
    return { kind: "error", message: "网络异常，请检查连接后重试" };
  }
}

/**
 * 上传战绩。同一 recordId 后端幂等，因此失败后重试安全。
 * placement：活到最后 = 1，否则按引擎给出的剩余名次。
 */
async function requestFinish(recordId: string, battle: BattleResult): Promise<FinishOutcome> {
  try {
    const response = await fetch("/api/pet/battle/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId,
        kills: battle.kills,
        placement: battle.win ? 1 : battle.rank,
        seconds: Math.max(0, Math.round(battle.survived)),
      }),
      cache: "no-store",
    });
    const data = await readJsonObject(response);

    if (!response.ok || data.ok !== true) {
      return { kind: "error", message: readApiError(data, response.status) };
    }

    const rawBreakdown = data.breakdown;
    const breakdown =
      rawBreakdown && typeof rawBreakdown === "object"
        ? (rawBreakdown as Record<string, unknown>)
        : {};
    const rawPet = data.pet;
    const pet =
      rawPet && typeof rawPet === "object" ? (rawPet as Record<string, unknown>) : {};

    return {
      kind: "ok",
      expGained:
        typeof data.expGained === "number" ? Math.max(0, Math.round(data.expGained)) : 0,
      placementExp: typeof breakdown.placement === "number" ? breakdown.placement : 0,
      killsExp: typeof breakdown.kills === "number" ? breakdown.kills : 0,
      tickets: typeof pet.tickets === "number" ? pet.tickets : null,
    };
  } catch {
    return { kind: "error", message: "网络异常，请稍后重试" };
  }
}

/* -------------------------------------------------------------------------- */
/* HUD                                                                        */
/* -------------------------------------------------------------------------- */

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6rem] items-center justify-center rounded border border-[var(--line)] bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--ink)] shadow-sm">
      {children}
    </kbd>
  );
}

function HudOverlay({
  hud,
  feed,
  minimapRef,
}: {
  hud: BattleHud;
  feed: FeedItem[];
  minimapRef: RefObject<HTMLCanvasElement | null>;
}) {
  const hpPercent = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const hpColor =
    hud.hp > 55 ? "bg-emerald-400" : hud.hp > 25 ? "bg-amber-400" : "bg-rose-500";
  const armorPercent =
    hud.maxArmor > 0 ? Math.max(0, Math.min(100, (hud.armor / hud.maxArmor) * 100)) : 0;

  const zoneLabel = hud.zone.final
    ? "决赛圈 · 毒圈已缩至最小"
    : hud.zone.shrinking
      ? `毒圈收缩中 · ${Math.ceil(hud.zone.timeLeft)}s`
      : `下次收缩 · ${Math.ceil(hud.zone.timeLeft)}s`;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* 生命 / 护甲 */}
      <div className="absolute left-3 top-3 w-[232px] rounded-xl border border-white/10 bg-[#071722]/85 p-2.5 text-white shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-white/55">生命</span>
          <span className="font-mono tabular-nums">
            {hud.hp}
            <span className="text-white/40"> / {hud.maxHp}</span>
          </span>
        </div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${hpColor}`}
            style={{ width: `${hpPercent}%`, transition: "width 120ms linear" }}
          />
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/45">
          <span>{hud.maxArmor > 0 ? "护甲" : "无护甲"}</span>
          {hud.maxArmor > 0 && (
            <span className="font-mono tabular-nums">
              {hud.armor} / {hud.maxArmor}
            </span>
          )}
        </div>
        {hud.maxArmor > 0 && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-sky-400"
              style={{ width: `${armorPercent}%`, transition: "width 120ms linear" }}
            />
          </div>
        )}

        <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/55">
          <span>
            淘汰 <span className="font-semibold text-white">{hud.kills}</span>
          </span>
          <span className="font-mono text-white/40">{formatClock(hud.elapsed)}</span>
        </div>
      </div>

      {/* 存活 / 倒计时 / 毒圈 */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#071722]/85 px-3 py-1.5 text-white shadow-lg backdrop-blur-sm">
          <span className="text-[10px] tracking-wide text-white/50">存活</span>
          <span className="font-display text-lg leading-none text-emerald-300">
            {hud.alive}
          </span>
          <span className="text-[10px] text-white/35">/ {hud.total}</span>
          <span className="mx-0.5 h-3.5 w-px bg-white/15" />
          <span className="font-mono text-sm tabular-nums">{formatClock(hud.timeLeft)}</span>
        </div>
        <div
          className={`rounded-full border px-2.5 py-0.5 text-[11px] backdrop-blur-sm ${
            hud.outside
              ? "border-rose-400/40 bg-rose-500/25 text-rose-100"
              : hud.zone.shrinking
                ? "border-fuchsia-300/30 bg-fuchsia-500/20 text-fuchsia-100"
                : "border-white/10 bg-[#071722]/75 text-white/65"
          }`}
        >
          {hud.outside
            ? `⚠ 毒圈外 · 每秒 -${Math.round(hud.damageRate)} 生命`
            : zoneLabel}
        </div>
      </div>

      {/* 小地图 */}
      <div className="absolute right-3 top-3 rounded-lg border border-white/15 bg-[#071722]/90 p-1.5 shadow-lg backdrop-blur-sm">
        <canvas
          ref={minimapRef}
          width={336}
          height={336}
          className="block h-[168px] w-[168px] rounded-md"
          aria-label="小地图：玩家位置、毒圈与附近敌人"
        />
        <div className="mt-1 flex items-center justify-between px-0.5 text-[10px] text-white/45">
          <span>小地图</span>
          <span>红点 = 附近敌人</span>
        </div>
      </div>

      {/* 击杀提示 */}
      <div className="absolute right-3 top-[212px] flex w-[228px] flex-col items-end gap-1">
        {feed.map((item) => (
          <div
            key={item.id}
            className={`max-w-full truncate rounded-md border px-2 py-1 text-[11px] shadow backdrop-blur-sm ${FEED_TONE_CLASS[item.tone]}`}
          >
            {item.text}
          </div>
        ))}
      </div>

      {/* 武器 / 弹药 */}
      <div className="absolute bottom-3 left-3 w-[248px] rounded-xl border border-white/10 bg-[#071722]/85 p-2.5 text-white shadow-lg backdrop-blur-sm">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] tracking-wide text-white/45">突击步枪 · 全自动</p>
            <p className="font-display text-2xl leading-none">
              {hud.mag}
              <span className="ml-1 text-sm text-white/45">/ {hud.reserve}</span>
            </p>
          </div>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              hud.reloading
                ? "bg-amber-400/20 text-amber-200"
                : "bg-white/10 text-white/55"
            }`}
          >
            {hud.reloading ? "换弹中" : "R 换弹"}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-amber-300"
            style={{ width: `${(hud.mag / 30) * 100}%`, transition: "width 80ms linear" }}
          />
        </div>
        {hud.reloading && (
          <div className="mt-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-sky-400"
                style={{ width: `${hud.reloadProgress * 100}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-sky-200/80">换弹中，找好掩体…</p>
          </div>
        )}
        {!hud.reloading && hud.mag === 0 && hud.reserve === 0 && (
          <p className="mt-1 text-[10px] text-rose-200/80">弹药耗尽，只能靠毒圈和走位了</p>
        )}
      </div>

      {/* 键鼠提示 */}
      <div className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full border border-white/10 bg-[#071722]/70 px-3 py-1 text-[11px] text-white/50 backdrop-blur-sm md:block">
        WASD 移动 · 鼠标瞄准 · 左键射击 · R 换弹
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 开始 / 结束界面                                                              */
/* -------------------------------------------------------------------------- */

function StartScreen({
  armor,
  tickets,
  onArmorChange,
  onStart,
}: {
  armor: number;
  tickets: number | null;
  onArmorChange: (armor: number) => void;
  onStart: () => void;
}) {
  return (
    <div className="no-scrollbar absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-[#041019]/70 p-3 backdrop-blur-[2px]">
      <div className="panel anim-fade-up my-auto w-full max-w-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
              Battle Royale · 2D
            </p>
            <h2 className="font-display mt-0.5 text-2xl">今晚吃鸡 · 训练场</h2>
          </div>
          <span className="badge badge-warn">21 人 · 单局 5 分钟</span>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          你和 20 名 AI 空降到 2400 × 2400 的荒岛。搜刮不靠运气，全靠枪法和走位：
          躲在箱子与树林后，盯着右上角小地图，活到最后一个。
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>🎫 本局消耗 1 张吃鸡券</span>
          <span className="font-semibold">
            {tickets !== null ? `当前剩余 ${tickets} 张` : "券数查询中"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-2">
            <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd>
            <span className="text-xs text-[var(--muted)]">/ 方向键移动</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-2">
            <span className="rounded border border-[var(--line)] bg-[var(--paper)] px-1.5 py-0.5 text-[11px] font-semibold">
              鼠标
            </span>
            <span className="text-xs text-[var(--muted)]">瞄准，左键持续射击</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-2">
            <Kbd>R</Kbd>
            <span className="text-xs text-[var(--muted)]">换弹（1.5 秒，弹匣 30 发）</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-2">
            <span className="text-sm">📦</span>
            <span className="text-xs text-[var(--muted)]">击杀附近敌人会掉落弹药，走上去补给</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-2">
            <span className="text-sm">☠️</span>
            <span className="text-xs text-[var(--muted)]">开局 15 秒后毒圈收缩，圈外掉血递增</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-2">
            <span className="text-sm">⏱️</span>
            <span className="text-xs text-[var(--muted)]">单局 5 分钟，超时按剩余人数排名</span>
          </div>
        </div>

        <div className="mt-3">
          <p className="label">选择护甲（护甲吸收 55% 伤害，但会拖慢移速）</p>
          <div className="grid grid-cols-3 gap-2">
            {ARMOR_OPTIONS.map((option) => {
              const active = armor === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onArmorChange(option.value)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition ${
                    active
                      ? "border-[var(--teal)] bg-[var(--teal-soft)] ring-1 ring-[var(--teal)]"
                      : "border-[var(--line)] bg-white hover:bg-[var(--chip)]"
                  }`}
                >
                  <span className="flex items-center justify-between text-sm font-medium">
                    {option.label}
                    <span className="text-[10px] font-normal text-[var(--teal)]">
                      {option.hint}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                    {option.detail}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button type="button" onClick={onStart} className="btn-primary mt-4 w-full py-3 text-base">
          开始游戏
        </button>
        <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
          活到最后 →「大吉大利，今晚吃鸡」 · 超时按剩余人数排名 · 建议使用键鼠
        </p>
      </div>
    </div>
  );
}

function NoTicketScreen() {
  return (
    <div className="no-scrollbar absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-[#041019]/75 p-3 backdrop-blur-[3px]">
      <div className="panel anim-fade-up my-auto w-full max-w-md p-5 text-center">
        <span className="badge badge-warn">吃鸡券不足</span>
        <h2 className="font-display mt-2 text-2xl">先攒几张吃鸡券吧</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          每 100 经验 +1 券，升阶奖励、喂食也能拿券。
          完成一次听写或磨耳朵，就能再来挑战。
        </p>
        <p className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">
          进入战场会消耗 1 张吃鸡券，当前券已用完，本局不会开始。
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/pet" className="btn-secondary flex-1">
            返回宠物页
          </Link>
          <Link href="/dictation" className="btn-primary flex-1">
            去学习
          </Link>
        </div>
      </div>
    </div>
  );
}

function EnterStatusScreen({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="no-scrollbar absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-[#041019]/70 p-3 backdrop-blur-[2px]">
      <div className="panel anim-fade-up my-auto w-full max-w-sm p-5 text-center">
        {error ? (
          <>
            <span className="badge badge-warn">进入失败</span>
            <h2 className="font-display mt-2 text-xl">没能进入战场</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{error}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onRetry} className="btn-primary flex-1">
                重试进入
              </button>
              <Link href="/pet" className="btn-secondary flex-1">
                返回宠物页
              </Link>
            </div>
          </>
        ) : (
          <>
            <span
              className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[var(--teal)] border-t-transparent"
              aria-hidden
            />
            <h2 className="font-display mt-3 text-xl">正在进入战场…</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              正在扣除 1 张吃鸡券并生成本局战绩凭证。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function EndScreen({
  result,
  finish,
  tickets,
  restartPending,
  restartError,
  onRestart,
  onRetryFinish,
}: {
  result: BattleResult;
  finish: FinishState;
  tickets: number | null;
  restartPending: boolean;
  restartError: string | null;
  onRestart: () => void;
  onRetryFinish: () => void;
}) {
  const reasonText =
    result.reason === "win"
      ? "全场唯一幸存者，这局稳了。"
      : result.reason === "timeout"
        ? "单局 5 分钟已到，按剩余人数结算。"
        : "被淘汰了，再来一局把名次打回去。";

  const submitting = finish.status === "submitting";
  const restartDisabled = submitting || restartPending;

  return (
    <div className="no-scrollbar absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-[#041019]/75 p-3 backdrop-blur-[3px]">
      <div className="panel anim-fade-up my-auto w-full max-w-md p-5 text-center">
        <span className={`badge ${result.win ? "badge-ok" : "badge-warn"}`}>
          {result.win ? "胜利" : result.reason === "timeout" ? "时间到" : "被淘汰"}
        </span>
        <h2
          className={`font-display mt-2 text-3xl ${
            result.win ? "text-[var(--teal)]" : "text-[var(--ink)]"
          }`}
        >
          {result.win ? "大吉大利，今晚吃鸡" : `第 ${result.rank} 名`}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{reasonText}</p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2.5">
            <p className="text-[11px] text-[var(--muted)]">排名</p>
            <p className="stat-value mt-1 text-xl">
              {result.win ? 1 : result.rank}
              <span className="text-xs text-[var(--muted)]"> / {result.total}</span>
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2.5">
            <p className="text-[11px] text-[var(--muted)]">淘汰</p>
            <p className="stat-value mt-1 text-xl text-[var(--accent)]">{result.kills}</p>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2.5">
            <p className="text-[11px] text-[var(--muted)]">存活</p>
            <p className="stat-value mt-1 text-xl">{formatDuration(result.survived)}</p>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-left">
          {finish.status === "done" ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--muted)]">本局获得经验</span>
                <span className="font-display text-xl text-[var(--teal)]">
                  +{finish.expGained}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                排名 +{finish.placementExp} · 击杀 +{finish.killsExp}
              </p>
              {tickets !== null && (
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  当前吃鸡券：<span className="font-semibold text-[var(--ink)]">{tickets}</span> 张
                </p>
              )}
            </>
          ) : finish.status === "error" ? (
            <>
              <p className="text-xs text-rose-600">战绩上传失败，可重试</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {finish.message}
              </p>
              <button
                type="button"
                onClick={onRetryFinish}
                disabled={submitting}
                className="btn-secondary mt-2 w-full px-3 py-1.5 text-xs disabled:opacity-60"
              >
                重试上传
              </button>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 py-1 text-xs text-[var(--muted)]">
              {submitting ? (
                <>
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--teal)] border-t-transparent"
                    aria-hidden
                  />
                  战绩上传中…
                </>
              ) : (
                "准备上传战绩…"
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onRestart}
            disabled={restartDisabled}
            className="btn-primary flex-1 disabled:opacity-60"
          >
            {restartPending ? "正在扣券…" : "再来一局"}
          </button>
          <Link href="/pet" className="btn-secondary flex-1">
            返回宠物
          </Link>
        </div>
        {restartError && (
          <p className="mt-2 text-[11px] text-rose-600">
            进入下一局失败：{restartError}
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                         */
/* -------------------------------------------------------------------------- */

export default function BattlePage() {
  const {
    containerRef,
    canvasRef,
    minimapRef,
    phase: gamePhase,
    hud,
    feed,
    result,
    muted,
    start,
    toggleMuted,
  } = useBattle();

  /** 外层结算状态：不改变 useBattle 内部的游戏状态机 */
  const [phase, setPhase] = useState<PagePhase>("loading");
  const [armor, setArmor] = useState(50);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<number | null>(null);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [finishState, setFinishState] = useState<FinishState>({ status: "idle" });
  const [restartPending, setRestartPending] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  /** 严格模式双挂载守卫：确保首次加载只扣一次券 */
  const enterMountRef = useRef(false);
  /** 防止「重试进入」被连点 */
  const enteringRef = useRef(false);
  /** 防止「再来一局」被连点 */
  const restartingRef = useRef(false);
  /** 同一 recordId 只自动上传一次（严格模式 / 重渲染） */
  const finishLockRef = useRef<string | null>(null);
  /** 防止重试上传被连点 */
  const finishingRef = useRef(false);

  const runEnter = useCallback(async () => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setEnterError(null);
    setPhase("loading");
    try {
      const outcome = await requestEnter();
      if (outcome.kind === "ok") {
        finishLockRef.current = null;
        setRecordId(outcome.recordId);
        setTickets(outcome.tickets);
        setFinishState({ status: "idle" });
        setPhase("ready");
      } else if (outcome.kind === "no-ticket") {
        setRecordId(null);
        setTickets(0);
        setPhase("no-ticket");
      } else {
        setEnterError(outcome.message);
      }
    } finally {
      enteringRef.current = false;
    }
  }, []);

  /** 首次挂载：先扣券，再展示开始界面（或券不足面板） */
  useEffect(() => {
    if (enterMountRef.current) return;
    enterMountRef.current = true;
    void runEnter();
  }, [runEnter]);

  const submitFinish = useCallback(async (id: string, battle: BattleResult) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishState({ status: "submitting" });
    try {
      const outcome = await requestFinish(id, battle);
      if (outcome.kind === "ok") {
        setFinishState({
          status: "done",
          expGained: outcome.expGained,
          placementExp: outcome.placementExp,
          killsExp: outcome.killsExp,
        });
        if (outcome.tickets !== null) setTickets(outcome.tickets);
      } else {
        setFinishState({ status: "error", message: outcome.message });
      }
    } finally {
      finishingRef.current = false;
    }
  }, []);

  /** 引擎结束 → 外层进入结算 */
  useEffect(() => {
    if (gamePhase === "over") setPhase("finished");
  }, [gamePhase]);

  /** 结算页首次出现时上传战绩；同一 recordId 只触发一次 */
  useEffect(() => {
    if (phase !== "finished" || !result || !recordId) return;
    if (finishLockRef.current === recordId) return;
    finishLockRef.current = recordId;
    void submitFinish(recordId, result);
  }, [phase, result, recordId, submitFinish]);

  const handleStart = () => {
    if (phase !== "ready" || !recordId) return;
    setPhase("playing");
    start(armor);
  };

  /** 再来一局必须重新扣券：拿到新 recordId 后才重置游戏 */
  const handleRestart = useCallback(async () => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    setRestartPending(true);
    setRestartError(null);
    try {
      const outcome = await requestEnter();
      if (outcome.kind === "ok") {
        finishLockRef.current = null;
        setRecordId(outcome.recordId);
        setTickets(outcome.tickets);
        setFinishState({ status: "idle" });
        setPhase("playing");
        start(armor);
      } else if (outcome.kind === "no-ticket") {
        setRecordId(null);
        setTickets(0);
        setPhase("no-ticket");
      } else {
        setRestartError(outcome.message);
      }
    } finally {
      restartingRef.current = false;
      setRestartPending(false);
    }
  }, [armor, start]);

  const handleFinishRetry = () => {
    if (!recordId || !result) return;
    void submitFinish(recordId, result);
  };

  const handleEnterRetry = () => {
    void runEnter();
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            href="/pet"
            className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          >
            ← 返回宠物
          </Link>
          <h1 className="font-display text-xl">吃鸡训练场</h1>
          <span className="badge badge-warn">🎫 本局消耗 1 张券</span>
          <span className="badge hidden sm:inline-flex">21 人 · 5 分钟</span>
          {tickets !== null && (
            <span className="badge hidden sm:inline-flex">剩余 {tickets} 张</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={muted}
            className="btn-secondary px-2.5 py-1 text-xs"
            title="切换音效"
          >
            音效{muted ? "关" : "开"}
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="panel relative mt-2 min-h-0 flex-1 overflow-hidden bg-[#061219]"
      >
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 block h-full w-full touch-none select-none ${
            phase === "playing" ? "cursor-none" : ""
          }`}
          aria-label="吃鸡战场"
        />

        {phase === "playing" && (
          <HudOverlay hud={hud} feed={feed} minimapRef={minimapRef} />
        )}

        {phase === "ready" && (
          <StartScreen
            armor={armor}
            tickets={tickets}
            onArmorChange={setArmor}
            onStart={handleStart}
          />
        )}

        {phase === "loading" && (
          <EnterStatusScreen error={enterError} onRetry={handleEnterRetry} />
        )}

        {phase === "no-ticket" && <NoTicketScreen />}

        {phase === "finished" && result && (
          <EndScreen
            result={result}
            finish={finishState}
            tickets={tickets}
            restartPending={restartPending}
            restartError={restartError}
            onRestart={handleRestart}
            onRetryFinish={handleFinishRetry}
          />
        )}
      </div>
    </div>
  );
}
