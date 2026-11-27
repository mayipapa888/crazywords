/**
 * 在线对战客户端协议与常量。
 *
 * 与 server/ws-server.mjs 中的同名常量保持一致；改规则时两边都要改。
 * 这些值用于客户端预测、插值与 HUD，服务端才是权威。
 */

export const WORLD_WIDTH = 1800;
export const WORLD_HEIGHT = 1800;
export const MAX_PLAYERS = 8;
export const MAX_HP = 100;

export const PLAYER_RADIUS = 18;
export const MOVE_SPEED = 260;

export const SHOOT_COOLDOWN_MS = 600;
export const MATCH_DURATION_SECONDS = 240;
export const SHRINK_START_SECONDS = 120;
export const RESET_DELAY_SECONDS = 10;
export const ZONE_START_RADIUS = 1300;

export type MatchPhase = "waiting" | "playing" | "ended";
export type HitCause = "gun" | "zone";

export type NetPlayer = {
  id: string;
  name: string;
  x: number;
  y: number;
  aimAngle: number;
  hp: number;
  kills: number;
  alive: boolean;
};

export type NetZone = {
  cx: number;
  cy: number;
  radius: number;
  targetRadius: number;
  shrinking: boolean;
  dps: number;
  shrinkIn: number;
  progress: number;
};

export type WelcomeMessage = {
  type: "welcome";
  selfId: string;
  name: string;
  world: { width: number; height: number };
  tickRate: number;
  maxPlayers: number;
  maxHp: number;
  matchDuration: number;
  shrinkStart: number;
  speed: number;
  shootCooldownMs: number;
  shootRange: number;
};

export type StateMessage = {
  type: "state";
  now: number;
  phase: MatchPhase;
  matchNo: number;
  players: NetPlayer[];
  zone: NetZone;
  alive: number;
  total: number;
  maxPlayers: number;
  elapsed: number;
  timeLeft: number;
  resetIn: number | null;
};

export type ShootMessage = {
  type: "shoot";
  id: string;
  name: string;
  aim: number;
  hitId: string | null;
  at: number;
};

export type HitMessage = {
  type: "hit";
  shooterId: string | null;
  targetId: string;
  damage: number;
  hp: number;
  cause: HitCause;
  x: number;
  y: number;
  at: number;
};

export type KillMessage = {
  type: "kill";
  killerId: string | null;
  killerName: string;
  victimId: string;
  victimName: string;
  kills: number;
  cause: HitCause;
  x: number;
  y: number;
  at: number;
};

export type MatchStartMessage = {
  type: "matchStart";
  matchNo: number;
  at: number;
  players: number;
  duration: number;
};

export type MatchEndMessage = {
  type: "matchEnd";
  matchNo: number;
  reason: "lastAlive" | "timeout";
  winnerId: string | null;
  winnerName: string | null;
  resetIn: number;
  ranking: { id: string; name: string; kills: number; placement: number }[];
};

export type NoticeMessage = {
  type: "notice";
  kind: "join" | "leave";
  name: string;
  total: number;
};

export type PongMessage = {
  type: "pong";
  t: number;
  now: number;
};

export type ServerMessage =
  | WelcomeMessage
  | StateMessage
  | ShootMessage
  | HitMessage
  | KillMessage
  | MatchStartMessage
  | MatchEndMessage
  | NoticeMessage
  | PongMessage;

/** 宽容解析：只做最必要的结构校验，坏消息直接丢弃，不让页面崩溃 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return null;

  switch (type) {
    case "state": {
      const state = value as Partial<StateMessage>;
      if (!Array.isArray(state.players)) return null;
      if (!state.zone || typeof state.zone.radius !== "number") return null;
      return value as StateMessage;
    }
    case "matchEnd": {
      const end = value as Partial<MatchEndMessage>;
      if (!Array.isArray(end.ranking)) return null;
      return value as MatchEndMessage;
    }
    case "welcome":
    case "shoot":
    case "hit":
    case "kill":
    case "matchStart":
    case "notice":
    case "pong":
      return value as ServerMessage;
    default:
      return null;
  }
}

/** 最短路径角度插值（处理 ±π 环绕） */
export function lerpAngle(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

/**
 * 推导 WS 地址：
 * - 本地开发（localhost:3000）→ ws://localhost:3100/ws
 * - 生产 → wss://<host>/ws（由 Nginx 反代到 127.0.0.1:3100）
 * - 部署在子路径时如 Nginx 实际反代的是 /english/ws，用 NEXT_PUBLIC_BATTLE_WS_URL 覆盖
 */
export function resolveWsUrl(): string {
  const override = process.env.NEXT_PUBLIC_BATTLE_WS_URL?.trim();
  if (override) return override;

  const { protocol, hostname, host, port } = window.location;
  const isLocal =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  // 本地 next dev / next start 默认 3000；WS 服务独立在 3100。
  // 生产即使从 localhost 访问也走同源 /ws（由 Nginx 反代）。
  if (isLocal && (process.env.NODE_ENV !== "production" || port === "3000" || port === "3001")) {
    return "ws://localhost:3100/ws";
  }
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/ws`;
}
