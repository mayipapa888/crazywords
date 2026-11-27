/**
 * CrazyWords「在线对战」WebSocket 服务（MVP，单房间 8 人，20Hz）
 *
 * 启动方式：node server/ws-server.mjs
 * 监听地址：127.0.0.1:3100，路径 /ws（仅本机；生产由 Nginx 反代 /ws → 127.0.0.1:3100）
 *
 * 依赖：ws（新增依赖）、@prisma/client（已有）；dotenv 从当前工作目录 .env 读取 DATABASE_URL。
 * 鉴权：浏览器先 POST /api/battle/online/ticket 拿到一次性 ticket，
 *       再连 ws://127.0.0.1:3100/ws?ticket=<token>；本进程消费 OnlineTicket 表记录。
 *
 * 进程间只通过 Prisma/OnlineTicket 共享票据，不与 Next.js 共享内存。
 * 常量需与 src/components/battle-online/protocol.ts 保持一致。
 */

import "dotenv/config";
import { createRequire } from "node:module";
import { WebSocket, WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */
/* 配置                                                                       */
/* -------------------------------------------------------------------------- */

const HOST = "127.0.0.1";
const PORT = 3100;
const WS_PATH = "/ws";

const WORLD_WIDTH = 1800;
const WORLD_HEIGHT = 1800;
const MAX_PLAYERS = 8;
const TICK_MS = 50; // 20Hz 广播
const MAX_HP = 100;

const PLAYER_RADIUS = 18;
const MOVE_SPEED = 260; // px/s，与客户端一致
/** 移动令牌桶：允许的瞬时突发距离 / 每秒可补回的倍数（防高频 input 瞬移） */
const MOVE_BURST = 90;
const MOVE_REFILL_FACTOR = 1.35;
const INPUT_MAX_STEP = 220; // 单条 input 硬上限

const SHOOT_COOLDOWN_MS = 600;
const SHOOT_RANGE = 900;
const SHOOT_CONE = 0.22; // 扇形半角（≈12.6°）
const SHOOT_DAMAGE = 25;

/* 机器人：对局开始时按人类数量补位，服务端权威 AI（不与客户端共享逻辑） */
const BOT_TARGET_TOTAL = 8; // 开局把总人数补齐到 8（人类 + 机器人）
const BOT_SPEED = 250; // px/s，略慢于真人
const BOT_SHOOT_RANGE = 700;
const BOT_HIT_CHANCE = 0.55;
const BOT_DAMAGE = 12;
const BOT_COOLDOWN_MS = 600;
const BOT_THINK_MIN_MS = 1200; // 每 1.2–2.0 秒做一次索敌 / 开火判定
const BOT_THINK_MAX_MS = 2000;
/** 机器人在安全区内游走的半径比例（随机偏移，避免全挤在圈心） */
const BOT_ZONE_MIN_FACTOR = 0.22;
const BOT_ZONE_MAX_FACTOR = 0.7;
/** 距毒圈边缘小于该值时视为“贴边”，优先向圈心移动（简单避圈） */
const BOT_ZONE_EDGE_MARGIN = 90;

const MATCH_DURATION = 240; // 4 分钟一局（缩圈放慢）
const SHRINK_START = 120; // 120 秒后开始收缩（放慢毒圈）
const ZONE_CENTER_X = WORLD_WIDTH / 2;
const ZONE_CENTER_Y = WORLD_HEIGHT / 2;
const ZONE_START_RADIUS = 1300; // 开局覆盖整张地图
const ZONE_END_RADIUS = 150;
const ZONE_SHRINK_SECONDS = MATCH_DURATION - SHRINK_START;

const RESET_DELAY_MS = 10_000; // 结算后 10 秒重置
const TICKET_TTL_MS = 60_000;
const HEARTBEAT_MS = 30_000;

const TAU = Math.PI * 2;

/* -------------------------------------------------------------------------- */
/* 工具                                                                       */
/* -------------------------------------------------------------------------- */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeAngle(angle) {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

function angleDelta(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** 返回当前毒圈状态；elapsed 单位秒 */
function zoneAt(elapsed) {
  const t = Math.max(0, elapsed);
  if (t < SHRINK_START) {
    return {
      cx: ZONE_CENTER_X,
      cy: ZONE_CENTER_Y,
      radius: ZONE_START_RADIUS,
      targetRadius: ZONE_START_RADIUS,
      shrinking: false,
      dps: 0,
      shrinkIn: SHRINK_START - t,
      progress: 0,
    };
  }
  const progress = Math.min(1, (t - SHRINK_START) / ZONE_SHRINK_SECONDS);
  return {
    cx: ZONE_CENTER_X,
    cy: ZONE_CENTER_Y,
    radius: ZONE_START_RADIUS + (ZONE_END_RADIUS - ZONE_START_RADIUS) * progress,
    targetRadius: ZONE_END_RADIUS,
    shrinking: progress < 1,
    // 收缩开始后每 15 秒 +2 伤害：2 → 18
    dps: Math.min(18, 2 + Math.floor((t - SHRINK_START) / 15) * 2),
    shrinkIn: 0,
    progress,
  };
}

function spawnPoint(radiusFactor = 0.65) {
  const zone = zoneAt(room.phase === "playing" ? room.elapsed : 0);
  const maxRadius = Math.max(80, zone.radius * radiusFactor);
  const angle = Math.random() * TAU;
  const radius = Math.sqrt(Math.random()) * maxRadius;
  return {
    x: clamp(zone.cx + Math.cos(angle) * radius, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS),
    y: clamp(zone.cy + Math.sin(angle) * radius, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS),
  };
}

/* -------------------------------------------------------------------------- */
/* 房间状态（单房间）                                                          */
/* -------------------------------------------------------------------------- */

const room = {
  /** "waiting" | "playing" | "ended" */
  phase: "waiting",
  startedAt: 0,
  elapsed: 0,
  endedAt: 0,
  matchNo: 0,
  winnerId: null,
  /** @type {Map<string, Player>} userId -> player */
  players: new Map(),
};

/**
 * @typedef {object} Player
 * @property {string} id
 * @property {string} name
 * @property {WebSocket | null} ws 机器人没有连接，为 null
 * @property {number} x
 * @property {number} y
 * @property {number} aim
 * @property {number} hp
 * @property {number} kills
 * @property {boolean} alive
 * @property {number} cooldownUntil
 * @property {number} lastInputAt
 * @property {number} lastSeq
 * @property {number} moveBudget
 * @property {boolean} [bot] 是否为服务端补位的机器人
 * @property {number} [nextThinkAt] 机器人下一次索敌 / 开火判定时间
 * @property {string | null} [targetId] 机器人当前锁定的目标
 * @property {number} [wanderAngle] 机器人绕安全区中心游走的角度
 * @property {number} [wanderUntil] 机器人重新随机游走角度的时间
 * @property {number} [zoneRadiusFactor] 机器人游走半径占安全区半径的比例
 */

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const player of room.players.values()) {
    if (player.bot || !player.ws) continue;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function alivePlayers() {
  return [...room.players.values()].filter((player) => player.alive);
}

function humanPlayers() {
  return [...room.players.values()].filter((player) => !player.bot);
}

function humanCount() {
  return humanPlayers().length;
}

function respawnPlayer(player) {
  const point = spawnPoint();
  player.x = point.x;
  player.y = point.y;
  player.aim = Math.random() * TAU - Math.PI;
  player.hp = MAX_HP;
  player.kills = 0;
  player.alive = true;
  player.cooldownUntil = 0;
  player.lastInputAt = 0;
  player.lastSeq = 0;
  player.moveBudget = MOVE_BURST;
}

function makeState() {
  const zone = zoneAt(room.elapsed);
  const alive = alivePlayers().length;
  return {
    type: "state",
    now: Date.now(),
    phase: room.phase,
    matchNo: room.matchNo,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      x: round(player.x),
      y: round(player.y),
      aimAngle: round(player.aim, 3),
      hp: Math.max(0, Math.ceil(player.hp)),
      kills: player.kills,
      alive: player.alive,
      bot: player.bot === true,
    })),
    zone: {
      cx: zone.cx,
      cy: zone.cy,
      radius: round(zone.radius),
      targetRadius: round(zone.targetRadius),
      shrinking: zone.shrinking,
      dps: zone.dps,
      shrinkIn: round(zone.shrinkIn),
      progress: round(zone.progress, 3),
    },
    alive,
    total: room.players.size,
    humans: humanCount(),
    maxPlayers: MAX_PLAYERS,
    elapsed: round(room.elapsed, 2),
    timeLeft: round(Math.max(0, MATCH_DURATION - room.elapsed), 2),
    resetIn:
      room.phase === "ended"
        ? Math.max(0, Math.ceil((room.endedAt + RESET_DELAY_MS - Date.now()) / 1000))
        : null,
  };
}

function broadcastState() {
  if (room.players.size > 0) broadcast(makeState());
}

/* -------------------------------------------------------------------------- */
/* 机器人                                                                      */
/* -------------------------------------------------------------------------- */

/** 创建一个机器人实体（结构与人类玩家一致，多一个 bot:true） */
function createBot(index) {
  const point = spawnPoint(0.65);
  const now = Date.now();
  return {
    id: `bot-${room.matchNo}-${index + 1}`,
    name: `机器人${index + 1}`,
    ws: null,
    bot: true,
    x: point.x,
    y: point.y,
    aim: Math.random() * TAU - Math.PI,
    hp: MAX_HP,
    kills: 0,
    alive: true,
    cooldownUntil: 0,
    lastInputAt: 0,
    lastSeq: 0,
    moveBudget: MOVE_BURST,
    nextThinkAt: now + 900 + Math.random() * 900,
    targetId: null,
    wanderAngle: Math.random() * TAU,
    wanderUntil: now + 3000 + Math.random() * 3000,
    zoneRadiusFactor:
      BOT_ZONE_MIN_FACTOR + Math.random() * (BOT_ZONE_MAX_FACTOR - BOT_ZONE_MIN_FACTOR),
  };
}

/** 开局补位：总人数补到 8；人类 ≥ 8 时不补 */
function spawnBots() {
  const wanted = Math.max(0, BOT_TARGET_TOTAL - humanCount());
  for (let i = 0; i < wanted; i += 1) {
    const bot = createBot(i);
    room.players.set(bot.id, bot);
  }
  return wanted;
}

function removeBots() {
  for (const [id, player] of room.players) {
    if (player.bot) room.players.delete(id);
  }
}

/** 人类中途加入时机器人让位，保证总人数不超过 MAX_PLAYERS */
function trimBotsToCapacity() {
  const humans = humanCount();
  const maxBots = Math.max(0, MAX_PLAYERS - humans);
  const bots = [...room.players.values()]
    .filter((player) => player.bot)
    .sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? 1 : -1; // 优先移除已淘汰的
      return a.kills - b.kills;
    });
  let botCount = bots.length;
  for (const bot of bots) {
    if (botCount <= maxBots) break;
    room.players.delete(bot.id);
    botCount -= 1;
  }
}

/* -------------------------------------------------------------------------- */
/* 对局流程                                                                    */
/* -------------------------------------------------------------------------- */

function startMatch() {
  room.phase = "playing";
  room.startedAt = Date.now();
  room.elapsed = 0;
  room.endedAt = 0;
  room.winnerId = null;
  room.matchNo += 1;

  // 机器人只在开局瞬间生成：先清掉上一局残留，再按当前真人数补位
  removeBots();
  for (const player of room.players.values()) respawnPlayer(player);
  const bots = spawnBots();

  console.log(
    `[ws] match #${room.matchNo} start · ${room.players.size} players (${humanCount()} humans + ${bots} bots)`,
  );
  broadcast({
    type: "matchStart",
    matchNo: room.matchNo,
    at: room.startedAt,
    players: room.players.size,
    humans: humanCount(),
    duration: MATCH_DURATION,
  });
  broadcastState();
}

function resetToWaiting() {
  room.phase = "waiting";
  room.startedAt = 0;
  room.elapsed = 0;
  room.endedAt = 0;
  room.winnerId = null;
  removeBots();
  for (const player of room.players.values()) respawnPlayer(player);
  broadcastState();
}

function clearRoom() {
  room.phase = "waiting";
  room.startedAt = 0;
  room.elapsed = 0;
  room.endedAt = 0;
  room.winnerId = null;
  room.matchNo = 0;
  room.players.clear();
}

function endMatch(winner, reason) {
  if (room.phase !== "playing") return;
  room.phase = "ended";
  room.endedAt = Date.now();
  room.winnerId = winner ? winner.id : null;

  // 先按结算前的存活状态排名：胜者 > 存活者（按击杀、血量）> 已淘汰者
  const ranking = [...room.players.values()]
    .sort((a, b) => {
      if (a.id === room.winnerId) return -1;
      if (b.id === room.winnerId) return 1;
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.kills - a.kills || b.hp - a.hp;
    })
    .map((player, index) => ({
      id: player.id,
      name: player.name,
      kills: player.kills,
      placement: index + 1,
    }));

  for (const player of room.players.values()) {
    player.alive = winner ? player.id === winner.id : false;
    if (player.alive) player.hp = Math.max(1, player.hp);
    else player.hp = 0;
  }

  console.log(
    `[ws] match #${room.matchNo} end · reason=${reason} · winner=${winner ? winner.name : "-"}`,
  );
  broadcast({
    type: "matchEnd",
    matchNo: room.matchNo,
    reason,
    winnerId: room.winnerId,
    winnerName: winner ? winner.name : null,
    resetIn: RESET_DELAY_MS / 1000,
    ranking,
  });
  broadcastState();
}

function maybeStartMatch() {
  if (room.phase !== "waiting") return;
  // 只按真人数量判断开局，机器人不会让等待阶段提前开始
  if (humanCount() < 2) return;
  startMatch();
}

function checkRoundEnd() {
  if (room.phase !== "playing") return;
  const alive = alivePlayers();
  const aliveHumans = alive.filter((player) => !player.bot);
  // 人类全灭：即使还有机器人也立即结束（人类按剩余存活名次排位）
  if (aliveHumans.length === 0) {
    endMatch(null, "lastAlive");
    return;
  }
  // 存活总数（人类 + 机器人）只剩 1 且是人类 → 该人类吃鸡
  if (alive.length === 1) {
    endMatch(alive[0], "lastAlive");
  }
}

/* -------------------------------------------------------------------------- */
/* 伤害 / 击杀                                                                 */
/* -------------------------------------------------------------------------- */

function killPlayer(killer, victim, cause) {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  if (killer && killer.id !== victim.id) killer.kills += 1;

  broadcast({
    type: "kill",
    killerId: killer ? killer.id : null,
    killerName: killer ? killer.name : "毒圈",
    victimId: victim.id,
    victimName: victim.name,
    kills: killer ? killer.kills : 0,
    cause,
    x: round(victim.x),
    y: round(victim.y),
    at: Date.now(),
  });

  checkRoundEnd();
}

function damagePlayer(attacker, target, damage, cause) {
  if (room.phase !== "playing" || !target.alive) return;
  target.hp = Math.max(0, target.hp - damage);

  broadcast({
    type: "hit",
    shooterId: attacker ? attacker.id : null,
    targetId: target.id,
    damage,
    hp: Math.ceil(target.hp),
    cause,
    x: round(target.x),
    y: round(target.y),
    at: Date.now(),
  });

  if (target.hp <= 0) killPlayer(attacker, target, cause);
}

/* -------------------------------------------------------------------------- */
/* 客户端消息                                                                  */
/* -------------------------------------------------------------------------- */

function handleInput(player, message) {
  if (!player.alive || room.phase === "ended") return;
  if (!isFiniteNumber(message.x) || !isFiniteNumber(message.y)) return;

  const now = Date.now();
  const previous = player.lastInputAt || now - TICK_MS;
  const dt = clamp((now - previous) / 1000, 0, 0.3);
  player.lastInputAt = now;

  // 令牌桶：按真实时间补回移动预算，高频消息无法换到额外位移
  player.moveBudget = Math.min(
    MOVE_BURST,
    player.moveBudget + MOVE_SPEED * MOVE_REFILL_FACTOR * dt,
  );
  const maxStep = Math.min(INPUT_MAX_STEP, player.moveBudget);

  const targetX = clamp(message.x, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS);
  const targetY = clamp(message.y, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS);

  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const dist = Math.hypot(dx, dy);

  if (dist > maxStep && dist > 0.001) {
    // 超速：只允许沿输入方向走 maxStep，防止瞬移 / 穿墙
    player.x += (dx / dist) * maxStep;
    player.y += (dy / dist) * maxStep;
    player.moveBudget = Math.max(0, player.moveBudget - maxStep);
  } else {
    player.x = targetX;
    player.y = targetY;
    player.moveBudget = Math.max(0, player.moveBudget - dist);
  }

  player.x = clamp(player.x, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS);
  player.y = clamp(player.y, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS);

  if (isFiniteNumber(message.aim)) player.aim = normalizeAngle(message.aim);
  if (isFiniteNumber(message.seq)) player.lastSeq = message.seq;
}

function handleShoot(player, message) {
  if (room.phase !== "playing" || !player.alive) return;
  if (!isFiniteNumber(message.aim)) return;

  const now = Date.now();
  if (now < player.cooldownUntil) return;
  player.cooldownUntil = now + SHOOT_COOLDOWN_MS;

  const aim = normalizeAngle(message.aim);
  player.aim = aim;

  let target = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const other of room.players.values()) {
    if (other.id === player.id || !other.alive) continue;
    const dx = other.x - player.x;
    const dy = other.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SHOOT_RANGE || dist < 0.001) continue;

    const angleTo = Math.atan2(dy, dx);
    // 距离越近，命中扇形越“宽”（把身体半径折算成角度），避免贴脸打空
    const cone = SHOOT_CONE + Math.atan2(PLAYER_RADIUS, dist);
    if (Math.abs(angleDelta(angleTo, aim)) > cone) continue;

    if (dist < bestDistance) {
      bestDistance = dist;
      target = other;
    }
  }

  broadcast({
    type: "shoot",
    id: player.id,
    name: player.name,
    aim: round(aim, 3),
    hitId: target ? target.id : null,
    at: now,
  });

  if (target) damagePlayer(player, target, SHOOT_DAMAGE, "gun");
}

/* -------------------------------------------------------------------------- */
/* 机器人 AI（服务端权威）                                                     */
/* -------------------------------------------------------------------------- */

/** 距离 700 内最近的存活单位（人类或机器人） */
function nearestTarget(bot) {
  let target = null;
  let best = BOT_SHOOT_RANGE;
  for (const other of room.players.values()) {
    if (other.id === bot.id || !other.alive) continue;
    const dist = distance(bot.x, bot.y, other.x, other.y);
    if (dist <= best) {
      best = dist;
      target = other;
    }
  }
  return target;
}

function updateBots(dt, now) {
  if (room.phase !== "playing") return;
  const zone = zoneAt(room.elapsed);

  for (const bot of room.players.values()) {
    if (!bot.bot || !bot.alive) continue;

    // 游走点：安全区内带随机偏移；贴边 / 圈外则向圈心靠拢（被毒圈推着走）
    if (now >= bot.wanderUntil) {
      bot.wanderAngle = Math.random() * TAU;
      bot.wanderUntil = now + 3000 + Math.random() * 3000;
      bot.zoneRadiusFactor =
        BOT_ZONE_MIN_FACTOR + Math.random() * (BOT_ZONE_MAX_FACTOR - BOT_ZONE_MIN_FACTOR);
    }

    const dxc = bot.x - zone.cx;
    const dyc = bot.y - zone.cy;
    const distCenter = Math.hypot(dxc, dyc);
    let tx;
    let ty;
    if (distCenter > Math.max(0, zone.radius - BOT_ZONE_EDGE_MARGIN)) {
      // 简单避圈：朝圈内 1/4 半径处走，尽快离开危险区
      tx = zone.cx + dxc * 0.25;
      ty = zone.cy + dyc * 0.25;
    } else {
      const radius = zone.radius * bot.zoneRadiusFactor;
      tx = zone.cx + Math.cos(bot.wanderAngle) * radius;
      ty = zone.cy + Math.sin(bot.wanderAngle) * radius;
    }

    const dx = tx - bot.x;
    const dy = ty - bot.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 10) {
      const step = Math.min(dist, BOT_SPEED * dt);
      bot.x = clamp(bot.x + (dx / dist) * step, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS);
      bot.y = clamp(bot.y + (dy / dist) * step, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS);
    }

    // 沿用上一次锁定的目标（若仍存活且在射程内）
    let aimTarget = null;
    if (bot.targetId) {
      const current = room.players.get(bot.targetId);
      if (
        current &&
        current.alive &&
        current.id !== bot.id &&
        distance(bot.x, bot.y, current.x, current.y) <= BOT_SHOOT_RANGE
      ) {
        aimTarget = current;
      } else {
        bot.targetId = null;
      }
    }

    // 每 1.2–2.0 秒索敌一次：700 内取最近目标，55% 命中，12 伤害，600ms 冷却
    if (now >= bot.nextThinkAt) {
      bot.nextThinkAt =
        now + BOT_THINK_MIN_MS + Math.random() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS);
      const target = nearestTarget(bot);
      bot.targetId = target ? target.id : null;
      aimTarget = target;

      if (target && now >= bot.cooldownUntil) {
        bot.cooldownUntil = now + BOT_COOLDOWN_MS;
        const baseAim = Math.atan2(target.y - bot.y, target.x - bot.x);
        const hit = Math.random() < BOT_HIT_CHANCE;
        // 未命中时给一个可见的偏角，客户端弹道不会“指哪打哪”
        const aim = hit ? baseAim : baseAim + (Math.random() - 0.5) * 0.6;
        bot.aim = baseAim;
        broadcast({
          type: "shoot",
          id: bot.id,
          name: bot.name,
          aim: round(aim, 3),
          hitId: hit ? target.id : null,
          at: now,
        });
        if (hit) {
          damagePlayer(bot, target, BOT_DAMAGE, "gun");
          if (room.phase !== "playing") return;
        }
      }
    }

    if (aimTarget && aimTarget.alive) {
      bot.aim = Math.atan2(aimTarget.y - bot.y, aimTarget.x - bot.x);
    } else if (dist > 10) {
      bot.aim = Math.atan2(dy, dx);
    }
  }
}

function applyZoneDamage(dt) {
  if (room.phase !== "playing" || room.elapsed < SHRINK_START) return;
  const zone = zoneAt(room.elapsed);
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    if (distance(player.x, player.y, zone.cx, zone.cy) <= zone.radius) continue;
    player.hp -= zone.dps * dt;
    if (player.hp <= 0) {
      player.hp = 0;
      killPlayer(null, player, "zone");
      if (room.phase !== "playing") return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 加入 / 离开                                                                 */
/* -------------------------------------------------------------------------- */

function addPlayer(ws, ticket) {
  const spawn = spawnPoint(0.55);
  /** @type {Player} */
  const player = {
    id: ticket.userId,
    name: ticket.username || "玩家",
    ws,
    x: spawn.x,
    y: spawn.y,
    aim: 0,
    hp: MAX_HP,
    kills: 0,
    alive: true,
    cooldownUntil: 0,
    lastInputAt: 0,
    lastSeq: 0,
    moveBudget: MOVE_BURST,
  };

  room.players.set(player.id, player);
  // 中途加入的真人优先于机器人：多出来时移除机器人，保持总人数 ≤ 8
  trimBotsToCapacity();
  ws.__playerId = player.id;

  send(ws, {
    type: "welcome",
    selfId: player.id,
    name: player.name,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    tickRate: 1000 / TICK_MS,
    maxPlayers: MAX_PLAYERS,
    maxHp: MAX_HP,
    matchDuration: MATCH_DURATION,
    shrinkStart: SHRINK_START,
    speed: MOVE_SPEED,
    shootCooldownMs: SHOOT_COOLDOWN_MS,
    shootRange: SHOOT_RANGE,
  });

  broadcast({
    type: "notice",
    kind: "join",
    name: player.name,
    total: room.players.size,
  });

  console.log(
    `[ws] + ${player.name} (${room.players.size}/${MAX_PLAYERS} · ${humanCount()} humans)`,
  );
  maybeStartMatch();
  broadcastState();
}

function removePlayer(player, reason) {
  if (room.players.get(player.id) !== player) return;
  room.players.delete(player.id);

  broadcast({
    type: "notice",
    kind: "leave",
    name: player.name,
    total: room.players.size,
  });

  console.log(
    `[ws] - ${player.name} (${room.players.size}/${MAX_PLAYERS} · ${humanCount()} humans) ${reason}`,
  );

  // 没有真人了：连机器人一起清空，避免出现“空房间里的机器人局”
  if (humanCount() === 0) {
    clearRoom();
    return;
  }

  if (room.phase === "playing") {
    // 掉线视为淘汰：人类全灭 / 只剩 1 个存活单位时直接结算
    checkRoundEnd();
  }
  broadcastState();
}

/* -------------------------------------------------------------------------- */
/* 票据校验                                                                    */
/* -------------------------------------------------------------------------- */

async function authenticate(ws, token) {
  try {
    const now = new Date();
    // 事务内“消费 + 读取”，避免与清理任务竞态；updateMany 的 count 保证一次性
    const [consumed, ticket] = await prisma.$transaction([
      prisma.onlineTicket.updateMany({
        where: { token, used: false, expiresAt: { gt: now } },
        data: { used: true },
      }),
      prisma.onlineTicket.findUnique({
        where: { token },
        select: { userId: true, username: true },
      }),
    ]);

    if (consumed.count !== 1 || !ticket) {
      ws.close(4001, "票据无效或已过期，请重试");
      return;
    }

    if (room.players.has(ticket.userId)) {
      ws.close(4003, "该账号已在房间中，请关闭其他标签页");
      return;
    }

    if (humanCount() >= MAX_PLAYERS) {
      ws.close(4002, "房间已满（最多 8 人），稍后再试");
      return;
    }

    if (ws.readyState !== WebSocket.OPEN) return;
    addPlayer(ws, ticket);
  } catch (error) {
    console.error("[ws] ticket 校验失败", error);
    try {
      ws.close(1011, "服务器繁忙，请重试");
    } catch {
      // 连接可能已经关闭，忽略
    }
  }
}

/* -------------------------------------------------------------------------- */
/* WebSocket 服务                                                              */
/* -------------------------------------------------------------------------- */

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  path: WS_PATH,
  perMessageDeflate: false,
  maxPayload: 4096,
  clientTracking: true,
});

wss.on("listening", () => {
  console.log(`[ws] online battle listening on ws://${HOST}:${PORT}${WS_PATH}`);
});

wss.on("error", (error) => {
  console.error("[ws] server error", error);
});

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("error", (error) => {
    console.warn("[ws] socket error", error?.message ?? error);
  });

  let url;
  try {
    url = new URL(req.url ?? WS_PATH, `http://${HOST}:${PORT}`);
  } catch {
    ws.close(4000, "请求地址无效");
    return;
  }

  const token = (url.searchParams.get("ticket") ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) {
    ws.close(4001, "缺少有效票据");
    return;
  }

  void authenticate(ws, token);

  ws.on("message", (raw) => {
    const player = ws.__playerId ? room.players.get(ws.__playerId) : null;
    if (!player) return;

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    switch (message.type) {
      case "input":
        handleInput(player, message);
        break;
      case "shoot":
        handleShoot(player, message);
        break;
      case "ping":
        if (isFiniteNumber(message.t)) {
          send(ws, { type: "pong", t: message.t, now: Date.now() });
        }
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    const player = ws.__playerId ? room.players.get(ws.__playerId) : null;
    delete ws.__playerId;
    if (player) removePlayer(player, "socket closed");
  });
});

/* -------------------------------------------------------------------------- */
/* 主循环：毒圈伤害、计时、结算后重置、20Hz 广播                                 */
/* -------------------------------------------------------------------------- */

let lastTickAt = Date.now();

const tickTimer = setInterval(() => {
  try {
    const now = Date.now();
    const dt = clamp((now - lastTickAt) / 1000, 0.001, 0.25);
    lastTickAt = now;

    if (room.phase === "playing") {
      room.elapsed = (now - room.startedAt) / 1000;
      updateBots(dt, now);
      if (room.phase === "playing") applyZoneDamage(dt);

      if (room.phase === "playing" && room.elapsed >= MATCH_DURATION) {
        const candidates = alivePlayers().sort(
          (a, b) => b.kills - a.kills || b.hp - a.hp,
        );
        endMatch(candidates[0] ?? null, "timeout");
      }
    } else if (room.phase === "ended" && now - room.endedAt >= RESET_DELAY_MS) {
      // 只有真人 ≥ 2 才开下一局（机器人不参与“凑人数开局”）
      if (humanCount() >= 2) startMatch();
      else resetToWaiting();
      return;
    }

    broadcastState();
  } catch (error) {
    console.error("[ws] tick error", error);
  }
}, TICK_MS);

/* 心跳：清理半开连接，避免房间人数虚高 */
const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // 忽略
    }
  }
}, HEARTBEAT_MS);

/* 过期票据清理（有效票据不受影响） */
async function cleanupTickets() {
  try {
    await prisma.onlineTicket.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - TICKET_TTL_MS) } },
    });
  } catch (error) {
    console.warn("[ws] 清理过期票据失败", error?.message ?? error);
  }
}
const cleanupTimer = setInterval(() => {
  void cleanupTickets();
}, 60_000);
void cleanupTickets();

/* 优雅退出 */
async function shutdown(signal) {
  console.log(`[ws] received ${signal}, shutting down`);
  clearInterval(tickTimer);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  for (const client of wss.clients) {
    try {
      client.close(1001, "server shutdown");
    } catch {
      // 忽略
    }
  }
  wss.close();
  try {
    await prisma.$disconnect();
  } catch {
    // 忽略
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
