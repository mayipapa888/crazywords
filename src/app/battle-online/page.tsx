"use client";

import { withBase } from "@/lib/base-path";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FALLBACK_ZONE,
  OnlineRenderer,
  type RenderFrame,
} from "@/components/battle-online/renderer";
import {
  MAX_HP,
  MAX_PLAYERS,
  MATCH_DURATION_SECONDS,
  MOVE_SPEED,
  PLAYER_RADIUS,
  RESET_DELAY_SECONDS,
  SHOOT_COOLDOWN_MS,
  SHRINK_START_SECONDS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  lerpAngle,
  parseServerMessage,
  resolveWsUrl,
  type MatchEndMessage,
  type MatchPhase,
  type NetPlayer,
  type NetZone,
  type StateMessage,
} from "@/components/battle-online/protocol";

/* -------------------------------------------------------------------------- */
/* 类型与常量                                                                  */
/* -------------------------------------------------------------------------- */

type ConnPhase = "connecting" | "online" | "error";
type FeedTone = "kill" | "death" | "zone" | "info";

type FeedItem = {
  id: number;
  text: string;
  tone: FeedTone;
};

type HudState = {
  hp: number;
  kills: number;
  alive: number;
  total: number;
  /** 真人数量；旧服务端没有 humans 字段时为 null */
  humans: number | null;
  selfAlive: boolean;
  timeLeft: number;
  phase: MatchPhase;
  outside: boolean;
  zoneShrinking: boolean;
  zoneDps: number;
  zoneIn: number;
  resetIn: number | null;
};

type Snapshot = {
  at: number;
  players: NetPlayer[];
  zone: NetZone;
  phase: MatchPhase;
};

const INITIAL_HUD: HudState = {
  hp: MAX_HP,
  kills: 0,
  alive: 0,
  total: 0,
  humans: null,
  selfAlive: false,
  timeLeft: MATCH_DURATION_SECONDS,
  phase: "waiting",
  outside: false,
  zoneShrinking: false,
  zoneDps: 0,
  zoneIn: SHRINK_START_SECONDS,
  resetIn: null,
};

const FEED_TONE_CLASS: Record<FeedTone, string> = {
  kill: "border-emerald-300/30 bg-emerald-500/15 text-emerald-100",
  death: "border-rose-300/40 bg-rose-500/20 text-rose-100",
  zone: "border-fuchsia-300/30 bg-fuchsia-500/15 text-fuchsia-100",
  info: "border-white/10 bg-white/5 text-white/70",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function zoneStatus(hud: HudState): { text: string; tone: string } {
  if (hud.phase === "waiting") {
    return {
      text: "等待对手加入",
      tone: "border-white/10 bg-[#071722]/75 text-white/60",
    };
  }
  if (hud.phase === "ended") {
    return {
      text: "本局已结束 · 等待重置",
      tone: "border-white/10 bg-[#071722]/75 text-white/60",
    };
  }
  if (hud.outside) {
    return {
      text: `⚠ 毒圈外 · 每秒 -${hud.zoneDps} 生命`,
      tone: "border-rose-400/40 bg-rose-500/25 text-rose-100",
    };
  }
  if (hud.zoneShrinking) {
    return {
      text: `毒圈收缩中 · 圈外 -${hud.zoneDps}/s`,
      tone: "border-fuchsia-300/30 bg-fuchsia-500/20 text-fuchsia-100",
    };
  }
  return {
    text: `下次收缩 · ${Math.ceil(hud.zoneIn)}s`,
    tone: "border-white/10 bg-[#071722]/75 text-white/65",
  };
}

/* -------------------------------------------------------------------------- */
/* 网络辅助                                                                    */
/* -------------------------------------------------------------------------- */

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 取一次性票据；失败时抛出可直接展示的中文原因 */
async function requestTicket(): Promise<{ ticket: string; username: string }> {
  const response = await fetch(withBase("/api/battle/online/ticket"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const data = await readJsonObject(response);

  if (!response.ok || data.ok !== true) {
    const message =
      typeof data.error === "string" && data.error.trim()
        ? data.error
        : response.status === 401
          ? "请先登录后再进入在线对战"
          : `获取票据失败（HTTP ${response.status}）`;
    throw new Error(message);
  }

  const ticket = typeof data.ticket === "string" ? data.ticket : "";
  if (!ticket) throw new Error("服务器未返回票据，请重试");
  return {
    ticket,
    username: typeof data.username === "string" ? data.username : "玩家",
  };
}

function closeReason(event: CloseEvent): string {
  if (event.reason) return event.reason;
  switch (event.code) {
    case 4001:
      return "票据无效或已过期，请重试";
    case 4002:
      return "房间已满（最多 8 人），请稍后再试";
    case 4003:
      return "该账号已在房间中，请关闭其他标签页";
    case 1006:
      return "无法连接对战服务器（请检查 Nginx 的 /ws 反代与 3100 端口）";
    case 1000:
      return "连接已关闭";
    default:
      return `连接已断开（code ${event.code}）`;
  }
}

/* -------------------------------------------------------------------------- */
/* 覆盖层组件                                                                  */
/* -------------------------------------------------------------------------- */

function HudOverlay({ hud, feed }: { hud: HudState; feed: FeedItem[] }) {
  const hpPercent = clamp(hud.hp, 0, MAX_HP);
  const hpColor =
    hud.hp > 55 ? "bg-emerald-400" : hud.hp > 25 ? "bg-amber-400" : "bg-rose-500";
  const status = zoneStatus(hud);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* 生命 / 击杀 */}
      <div className="absolute left-3 top-3 w-[224px] rounded-xl border border-white/10 bg-[#071722]/85 p-2.5 text-white shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-white/55">生命</span>
          <span className="font-mono tabular-nums">
            {hud.hp}
            <span className="text-white/40"> / {MAX_HP}</span>
          </span>
        </div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${hpColor}`}
            style={{ width: `${hpPercent}%`, transition: "width 120ms linear" }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/55">
          <span>
            击杀 <span className="font-semibold text-white">{hud.kills}</span>
          </span>
          <span className="font-mono text-white/40">{formatClock(hud.timeLeft)}</span>
        </div>
        <div className="mt-1 text-[10px] text-white/40">
          {hud.humans === null
            ? `房间 ${hud.total}/${MAX_PLAYERS} 人`
            : `真人 ${hud.humans} · 机器人 ${Math.max(0, hud.total - hud.humans)}`}
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
          className={`rounded-full border px-2.5 py-0.5 text-[11px] backdrop-blur-sm ${status.tone}`}
        >
          {status.text}
        </div>
      </div>

      {/* 击杀播报 */}
      <div className="absolute right-3 top-3 flex w-[248px] flex-col items-end gap-1">
        {feed.map((item) => (
          <div
            key={item.id}
            className={`max-w-full truncate rounded-md border px-2 py-1 text-[11px] shadow backdrop-blur-sm ${FEED_TONE_CLASS[item.tone]}`}
          >
            {item.text}
          </div>
        ))}
      </div>

      {/* 操作提示 */}
      <div className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full border border-white/10 bg-[#071722]/70 px-3 py-1 text-[11px] text-white/50 backdrop-blur-sm md:block">
        WASD 移动 · 鼠标瞄准 · 左键射击（600ms 冷却）
      </div>
    </div>
  );
}

function ConnectOverlay({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#041019]/80 p-3 backdrop-blur-[3px]">
      <div className="panel anim-fade-up w-full max-w-sm p-5 text-center">
        {error ? (
          <>
            <span className="badge badge-warn">连接失败</span>
            <h2 className="font-display mt-2 text-xl">没能进入在线房间</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{error}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onRetry} className="btn-primary flex-1">
                重新连接
              </button>
              <Link href="/pet" className="btn-secondary flex-1">
                返回宠物
              </Link>
            </div>
          </>
        ) : (
          <>
            <span
              className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[var(--teal)] border-t-transparent"
              aria-hidden
            />
            <h2 className="font-display mt-3 text-xl">正在进入在线房间…</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              正在申请连接票据并连接对战服务器。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function WaitingOverlay({ total }: { total: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-3">
      <div className="rounded-xl border border-white/10 bg-[#071722]/85 px-5 py-4 text-center text-white shadow-xl backdrop-blur-sm">
        <p className="font-display text-xl">等待对手加入…</p>
        <p className="mt-1 text-sm text-white/60">
          当前 {total}/{MAX_PLAYERS} 人 · 满 2 人自动开局
        </p>
        <p className="mt-1 text-[11px] text-white/45">开局后机器人补位到 8 人混战</p>
        <p className="mt-2 text-[11px] text-white/40">
          把网址发给朋友，或先熟悉 WASD / 鼠标操作
        </p>
      </div>
    </div>
  );
}

function DeadOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center pb-16">
      <div className="rounded-xl border border-rose-300/30 bg-rose-950/80 px-5 py-3 text-center text-white shadow-xl backdrop-blur-sm">
        <p className="font-display text-lg text-rose-200">已被淘汰</p>
        <p className="mt-0.5 text-xs text-white/60">观战中 · 本局结束后自动开始下一局</p>
      </div>
    </div>
  );
}

function ResultOverlay({
  result,
  selfId,
  resetIn,
}: {
  result: MatchEndMessage;
  selfId: string;
  resetIn: number;
}) {
  const win = result.winnerId === selfId;
  const myRank = result.ranking.find((item) => item.id === selfId) ?? null;
  const title = win
    ? "大吉大利，今晚吃鸡"
    : result.winnerName
      ? `${result.winnerName} 获胜`
      : "本局结束";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#041019]/75 p-3 backdrop-blur-[3px]">
      <div className="panel anim-fade-up w-full max-w-md p-5 text-center">
        <span className={`badge ${win ? "badge-ok" : "badge-warn"}`}>
          {result.reason === "timeout" ? "时间到" : win ? "胜利" : "本局结束"}
        </span>
        <h2
          className={`font-display mt-2 text-3xl ${
            win ? "text-[var(--teal)]" : "text-[var(--ink)]"
          }`}
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {myRank
            ? `第 ${myRank.placement} 名 · ${myRank.kills} 击杀`
            : `本局 ${result.ranking.length} 人参与`}
        </p>

        <ul className="mt-3 space-y-1 text-left text-xs">
          {result.ranking.slice(0, 3).map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5"
            >
              <span className="truncate">
                <span className="font-semibold text-[var(--ink)]">{item.placement}.</span>{" "}
                {item.name}
                {item.id === selfId ? (
                  <span className="ml-1 text-[10px] text-[var(--teal)]">（你）</span>
                ) : null}
              </span>
              <span className="shrink-0 text-[var(--muted)]">{item.kills} 击杀</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-[var(--muted)]">
          {Math.max(0, resetIn)} 秒后开始新一局
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/pet" className="btn-secondary flex-1">
            返回宠物
          </Link>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                        */
/* -------------------------------------------------------------------------- */

export default function BattleOnlinePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<OnlineRenderer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const runIdRef = useRef(0);

  const wsOpenRef = useRef(false);
  const selfIdRef = useRef("");
  const phaseRef = useRef<MatchPhase>("waiting");
  const meRef = useRef({
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    aim: 0,
    alive: false,
  });
  const latestStateRef = useRef<StateMessage | null>(null);
  const snapshotsRef = useRef<Snapshot[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const firingRef = useRef(false);
  const lastShotAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastInputAtRef = useRef(Number.NEGATIVE_INFINITY);
  const seqRef = useRef(0);
  const forceSnapRef = useRef(true);
  const feedIdRef = useRef(0);
  const feedTimersRef = useRef<number[]>([]);

  const [conn, setConn] = useState<ConnPhase>("connecting");
  const [connError, setConnError] = useState("");
  const [selfId, setSelfId] = useState("");
  const [selfName, setSelfName] = useState("");
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [result, setResult] = useState<MatchEndMessage | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /* ------------------------------ 小工具 ------------------------------ */

  const pushFeed = useCallback((text: string, tone: FeedTone) => {
    const id = feedIdRef.current + 1;
    feedIdRef.current = id;
    setFeed((prev) => [...prev.slice(-4), { id, text, tone }]);

    const timer = window.setTimeout(() => {
      setFeed((prev) => prev.filter((item) => item.id !== id));
      feedTimersRef.current = feedTimersRef.current.filter((item) => item !== timer);
    }, 6000);
    feedTimersRef.current.push(timer);
  }, []);

  /* ------------------------------ 状态处理 ---------------------------- */

  const applyState = useCallback((state: StateMessage) => {
    latestStateRef.current = state;
    // 换局 / 回到等待：客户端位置必须以服务端新出生点为准
    if (phaseRef.current !== state.phase) forceSnapRef.current = true;
    phaseRef.current = state.phase;

    const self = state.players.find((player) => player.id === selfIdRef.current) ?? null;
    if (self) {
      const drift = Math.hypot(self.x - meRef.current.x, self.y - meRef.current.y);
      if (forceSnapRef.current || !self.alive || drift > 140) {
        meRef.current.x = self.x;
        meRef.current.y = self.y;
        meRef.current.aim = self.aimAngle;
        forceSnapRef.current = false;
      }
      meRef.current.alive = self.alive;
    }

    snapshotsRef.current.push({
      at: performance.now(),
      players: state.players,
      zone: state.zone,
      phase: state.phase,
    });
    if (snapshotsRef.current.length > 10) snapshotsRef.current.shift();

    const outside =
      !!self &&
      self.alive &&
      Math.hypot(self.x - state.zone.cx, self.y - state.zone.cy) > state.zone.radius;

    setHud({
      hp: self?.hp ?? MAX_HP,
      kills: self?.kills ?? 0,
      alive: state.alive,
      total: state.total,
      humans: typeof state.humans === "number" ? state.humans : null,
      selfAlive: self?.alive ?? false,
      timeLeft: state.timeLeft,
      phase: state.phase,
      outside,
      zoneShrinking: state.zone.shrinking,
      zoneDps: state.zone.dps,
      zoneIn: state.zone.shrinkIn,
      resetIn: state.resetIn,
    });
    setResult((prev) => (prev && state.phase !== "ended" ? null : prev));
  }, []);

  const handleMessage = useCallback(
    (raw: string) => {
      const message = parseServerMessage(raw);
      if (!message) return;

      switch (message.type) {
        case "welcome":
          selfIdRef.current = message.selfId;
          setSelfId(message.selfId);
          setSelfName(message.name);
          setConn("online");
          setConnError("");
          forceSnapRef.current = true;
          break;

        case "state":
          applyState(message);
          break;

        case "shoot": {
          const state = latestStateRef.current;
          const shooter = state?.players.find((player) => player.id === message.id);
          if (shooter && message.id !== selfIdRef.current) {
            rendererRef.current?.addTracer(shooter.x, shooter.y, message.aim, false);
          }
          break;
        }

        case "hit":
          rendererRef.current?.addDamage(message.x, message.y, message.damage);
          rendererRef.current?.markHit(message.targetId);
          if (message.targetId === selfIdRef.current) {
            rendererRef.current?.addHitFlash();
          }
          break;

        case "kill": {
          const victimMe = message.victimId === selfIdRef.current;
          const killerMe = message.killerId === selfIdRef.current;
          const victimBot =
            latestStateRef.current?.players.find(
              (player) => player.id === message.victimId,
            )?.bot === true;
          const text = message.killerId
            ? victimBot
              ? `${message.killerName} 击杀 ${message.victimName}`
              : `${message.killerName} 淘汰了 ${message.victimName}`
            : `${message.victimName} 被毒圈淘汰`;
          pushFeed(
            text,
            victimMe ? "death" : killerMe ? "kill" : message.cause === "zone" ? "zone" : "info",
          );
          break;
        }

        case "matchStart":
          snapshotsRef.current = [];
          setFeed([]);
          setResult(null);
          forceSnapRef.current = true;
          // 在收到新一局首个 state 前暂停本地移动/射击，避免用旧位置覆盖出生点
          meRef.current.alive = false;
          pushFeed("本局开始，活到最后！", "info");
          break;

        case "matchEnd":
          setResult(message);
          break;

        case "notice":
          pushFeed(
            message.kind === "join"
              ? `${message.name} 加入了房间`
              : `${message.name} 离开了房间`,
            "info",
          );
          break;

        default:
          break;
      }
    },
    [applyState, pushFeed],
  );

  /* ------------------------------ 连接 -------------------------------- */

  const connect = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    const previous = socketRef.current;
    socketRef.current = null;
    wsOpenRef.current = false;
    if (previous) {
      previous.onclose = null;
      previous.close();
    }

    setConn("connecting");
    setConnError("");
    setResult(null);
    setFeed([]);
    setHud(INITIAL_HUD);
    setSelfId("");
    setSelfName("");
    selfIdRef.current = "";
    latestStateRef.current = null;
    snapshotsRef.current = [];
    phaseRef.current = "waiting";
    forceSnapRef.current = true;
    meRef.current = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      aim: 0,
      alive: false,
    };

    let ticket: string;
    let username: string;
    try {
      const outcome = await requestTicket();
      ticket = outcome.ticket;
      username = outcome.username;
    } catch (error) {
      if (runId !== runIdRef.current) return;
      setConn("error");
      setConnError(error instanceof Error ? error.message : "获取票据失败");
      return;
    }

    if (runId !== runIdRef.current) return;
    setSelfName(username);

    const ws = new WebSocket(`${resolveWsUrl()}?ticket=${encodeURIComponent(ticket)}`);
    socketRef.current = ws;

    ws.onopen = () => {
      wsOpenRef.current = true;
    };
    ws.onmessage = (event) => {
      if (runId !== runIdRef.current) return;
      if (typeof event.data === "string") handleMessage(event.data);
    };
    ws.onclose = (event) => {
      wsOpenRef.current = false;
      if (runId !== runIdRef.current) return;
      setConn("error");
      setConnError(closeReason(event));
    };
  }, [handleMessage]);

  useEffect(() => {
    void connect();
    return () => {
      runIdRef.current += 1;
      const ws = socketRef.current;
      socketRef.current = null;
      wsOpenRef.current = false;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [connect]);

  useEffect(
    () => () => {
      for (const timer of feedTimersRef.current) window.clearTimeout(timer);
      feedTimersRef.current = [];
    },
    [],
  );

  /* ------------------------------ 帧循环 ------------------------------ */

  const sendShoot = useCallback((aim: number) => {
    const ws = socketRef.current;
    if (!ws || !wsOpenRef.current || ws.readyState !== WebSocket.OPEN) return;
    if (phaseRef.current !== "playing" || !meRef.current.alive) return;

    const now = performance.now();
    if (now - lastShotAtRef.current < SHOOT_COOLDOWN_MS + 20) return;
    lastShotAtRef.current = now;

    ws.send(JSON.stringify({ type: "shoot", aim }));
    rendererRef.current?.addTracer(meRef.current.x, meRef.current.y, aim, true);
  }, []);

  const stepLocal = useCallback(
    (now: number, dt: number) => {
      const canvas = canvasRef.current;
      const ws = socketRef.current;
      if (!canvas || !ws || !wsOpenRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const aim = Math.atan2(
        pointerRef.current.y - rect.height / 2,
        pointerRef.current.x - rect.width / 2,
      );
      meRef.current.aim = aim;

      if (!meRef.current.alive || phaseRef.current === "ended") return;

      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("w") || keys.has("arrowup")) dy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) dy += 1;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
      if (keys.has("d") || keys.has("arrowright")) dx += 1;

      if (dx !== 0 || dy !== 0) {
        const length = Math.hypot(dx, dy);
        meRef.current.x = clamp(
          meRef.current.x + (dx / length) * MOVE_SPEED * dt,
          PLAYER_RADIUS,
          WORLD_WIDTH - PLAYER_RADIUS,
        );
        meRef.current.y = clamp(
          meRef.current.y + (dy / length) * MOVE_SPEED * dt,
          PLAYER_RADIUS,
          WORLD_HEIGHT - PLAYER_RADIUS,
        );
      }

      if (now - lastInputAtRef.current >= 50) {
        lastInputAtRef.current = now;
        seqRef.current += 1;
        ws.send(
          JSON.stringify({
            type: "input",
            seq: seqRef.current,
            x: Math.round(meRef.current.x * 10) / 10,
            y: Math.round(meRef.current.y * 10) / 10,
            aim: Math.round(aim * 1000) / 1000,
            firing: firingRef.current,
          }),
        );
      }

      if (firingRef.current) sendShoot(aim);
    },
    [sendShoot],
  );

  const buildFrame = useCallback((now: number): RenderFrame => {
    const snapshots = snapshotsRef.current;
    let players: NetPlayer[] = [];
    let zone: NetZone = FALLBACK_ZONE;
    let phase: MatchPhase = phaseRef.current;

    if (snapshots.length === 1) {
      players = snapshots[0].players.map((player) => ({ ...player }));
      zone = snapshots[0].zone;
      phase = snapshots[0].phase;
    } else if (snapshots.length >= 2) {
      const older = snapshots[snapshots.length - 2];
      const newer = snapshots[snapshots.length - 1];
      const span = Math.max(1, newer.at - older.at);
      const t = clamp((now - older.at) / span, 0, 1);
      const previous = new Map(older.players.map((player) => [player.id, player]));

      players = newer.players.map((player) => {
        const before = previous.get(player.id);
        if (!before) return { ...player };
        return {
          ...player,
          x: before.x + (player.x - before.x) * t,
          y: before.y + (player.y - before.y) * t,
          aimAngle: lerpAngle(before.aimAngle, player.aimAngle, t),
        };
      });
      zone = newer.zone;
      phase = newer.phase;
    }

    const me = meRef.current;
    const self = players.find((player) => player.id === selfIdRef.current);
    if (self && me.alive && self.alive) {
      self.x = me.x;
      self.y = me.y;
      self.aimAngle = me.aim;
    }

    const outside =
      me.alive &&
      phase === "playing" &&
      Math.hypot(me.x - zone.cx, me.y - zone.cy) > zone.radius;

    // 机器人名字前加标识，和真人区分（服务端名字本身是「机器人N」）
    const viewPlayers = players.map((player) =>
      player.bot ? { ...player, name: `🤖 ${player.name}` } : player,
    );

    return {
      players: viewPlayers,
      zone,
      selfId: selfIdRef.current,
      phase,
      camera: { x: me.x, y: me.y },
      aim: me.aim,
      firing: firingRef.current,
      pointer: pointerRef.current,
      selfAlive: !!self && self.alive,
      outside,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: OnlineRenderer;
    try {
      renderer = new OnlineRenderer(canvas);
    } catch {
      return;
    }
    rendererRef.current = renderer;

    let raf = 0;
    let last = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      stepLocal(now, dt);
      renderer.render(buildFrame(now), dt);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      rendererRef.current = null;
    };
  }, [buildFrame, stepLocal]);

  /* ------------------------------ 输入 -------------------------------- */

  useEffect(() => {
    const keys = keysRef.current;
    const movementKeys = new Set([
      "w",
      "a",
      "s",
      "d",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
    ]);

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!movementKeys.has(key)) return;
      if (key.startsWith("arrow")) event.preventDefault();
      keys.add(key);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.key.toLowerCase());
    };
    const onBlur = () => {
      keys.clear();
      firingRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside:
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      updatePointer(event);
      firingRef.current = true;

      const rect = canvas.getBoundingClientRect();
      const aim = Math.atan2(
        event.clientY - rect.top - rect.height / 2,
        event.clientX - rect.left - rect.width / 2,
      );
      sendShoot(aim);
    };

    const onPointerMove = (event: PointerEvent) => updatePointer(event);
    const onPointerUp = (event: PointerEvent) => {
      if (event.button === 0) firingRef.current = false;
    };
    const onPointerLeave = () => {
      pointerRef.current.inside = false;
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    const onBlur = () => {
      firingRef.current = false;
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("blur", onBlur);

    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [sendShoot]);

  /* ------------------------------ 全屏 -------------------------------- */

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await element.requestFullscreen();
      }
    } catch {
      // 浏览器拒绝时静默，不影响对战
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      void toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  /* ------------------------------ 渲染 -------------------------------- */

  const resetIn = hud.resetIn ?? result?.resetIn ?? RESET_DELAY_SECONDS;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            href="/pet"
            className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          >
            ← 返回宠物
          </Link>
          <h1 className="font-display text-xl">在线对战</h1>
          <span className="badge badge-ok">
            房间 {hud.total}/{MAX_PLAYERS}
          </span>
          <span className="badge">你：{selfName || "连接中…"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`hidden text-[11px] sm:inline ${
              conn === "online"
                ? "text-[var(--ok)]"
                : conn === "connecting"
                  ? "text-[var(--muted)]"
                  : "text-[var(--danger)]"
            }`}
          >
            {conn === "online" ? "已连接" : conn === "connecting" ? "连接中…" : "已断开"}
          </span>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="btn-secondary px-2.5 py-1 text-xs"
            title="全屏 / 退出全屏（快捷键 F）"
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? "退出全屏" : "全屏"}
          </button>
        </div>
      </header>

      <div
        ref={containerRef}
        className="panel relative mt-2 min-h-0 flex-1 overflow-hidden bg-[#061219]"
      >
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 block h-full w-full touch-none select-none ${
            conn === "online" && hud.phase === "playing" ? "cursor-none" : ""
          }`}
          aria-label="在线对战战场"
        />

        {conn === "online" ? <HudOverlay hud={hud} feed={feed} /> : null}

        {conn === "online" && hud.phase === "waiting" && !result ? (
          <WaitingOverlay total={hud.total} />
        ) : null}

        {conn === "online" && hud.phase === "playing" && !hud.selfAlive && !result ? (
          <DeadOverlay />
        ) : null}

        {conn !== "online" ? (
          <ConnectOverlay
            error={conn === "error" ? connError : null}
            onRetry={() => void connect()}
          />
        ) : null}

        {result ? (
          <ResultOverlay result={result} selfId={selfId} resetIn={resetIn} />
        ) : null}
      </div>
    </div>
  );
}
