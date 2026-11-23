/**
 * 吃鸡训练场 · 纯逻辑引擎（不依赖 React / DOM）
 *
 * - 21 名单位（玩家 + 20 AI）在 2400×2400 的地图上混战
 * - 固定 60Hz 步进：页面每帧调用 step(1/60, input)
 * - 子弹 / 粒子使用对象池，避免每帧创建对象
 * - 毒圈按时间轴分阶段收缩，圈外伤害随时间递增
 */

export const WORLD_SIZE = 2400;
export const PLAYER_COUNT = 21;
export const FIGHTER_RADIUS = 15;
export const MAG_SIZE = 30;
export const RESERVE_AMMO = 120;
export const RELOAD_SECONDS = 1.5;
export const MATCH_SECONDS = 300;
export const ZONE_CENTER = WORLD_SIZE / 2;

const TAU = Math.PI * 2;
const BULLET_POOL = 320;
const PARTICLE_POOL = 260;
const PICKUP_POOL = 32;
const PICKUP_AMMO = 30;
const PICKUP_HEAL = 35;
const PICKUP_LIFE = 45;
const RESERVE_CAP = 240;
const MAX_HP = 100;
/** 击杀掉落时出医疗包的概率 */
const PICKUP_MED_CHANCE = 0.35;
/** 开局地图上散布的补给数量 */
const INITIAL_AMMO_CRATES = 10;
const INITIAL_MED_KITS = 8;

export type ObstacleKind = "crate" | "tree";
export type AiState = "wander" | "hunt" | "zone";

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  /** 树为半径；箱子为半边长 */
  r: number;
}

export interface Fighter {
  id: number;
  name: string;
  isPlayer: boolean;
  x: number;
  y: number;
  angle: number;
  hp: number;
  armor: number;
  maxArmor: number;
  alive: boolean;
  color: string;
  speed: number;
  mag: number;
  reserve: number;
  /** > 0 表示换弹中，倒计时 */
  reloadTimer: number;
  fireCooldown: number;
  muzzle: number;
  hitFlash: number;
  deadAt: number;
  kills: number;
  state: AiState;
  targetId: number;
  decisionTimer: number;
  reaction: number;
  strafe: number;
  skill: number;
  wanderX: number;
  wanderY: number;
  wanderTimer: number;
  lastAttackerId: number;
  attackerTimer: number;
  outsideTimer: number;
}

export interface Bullet {
  active: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  ownerId: number;
  damage: number;
  range: number;
  traveled: number;
  fromPlayer: boolean;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export type PickupKind = "ammo" | "med";

export interface Pickup {
  active: boolean;
  kind: PickupKind;
  x: number;
  y: number;
  amount: number;
  life: number;
}

export type FeedTone = "player-kill" | "player-death" | "zone" | "other" | "loot";

export type BattleSoundName =
  | "shot"
  | "hit"
  | "hurt"
  | "reload"
  | "reload-done"
  | "empty"
  | "kill"
  | "pickup";

export type BattleEvent =
  | { type: BattleSoundName }
  | { type: "feed"; text: string; tone: FeedTone };

export type BattleResultReason = "win" | "dead" | "timeout";

export interface BattleResult {
  win: boolean;
  rank: number;
  total: number;
  kills: number;
  survived: number;
  reason: BattleResultReason;
}

export interface ZoneState {
  radius: number;
  targetRadius: number;
  dps: number;
  phase: number;
  shrinking: boolean;
  timeLeft: number;
  final: boolean;
}

export interface ZoneHud {
  radius: number;
  dps: number;
  phase: number;
  shrinking: boolean;
  timeLeft: number;
  final: boolean;
}

export interface BattleHud {
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  mag: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  alive: number;
  total: number;
  kills: number;
  timeLeft: number;
  elapsed: number;
  zone: ZoneHud;
  outside: boolean;
  damageRate: number;
}

export interface StepInput {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  firing: boolean;
}

interface ZoneStage {
  /** 等待时间（秒） */
  wait: number;
  /** 收缩时间（秒） */
  shrink: number;
  from: number;
  to: number;
  dps: number;
}

/** 开局 15 秒后开始第一次收缩，之后逐级加速 */
const ZONE_STAGES: ZoneStage[] = [
  { wait: 15, shrink: 20, from: 2000, to: 1250, dps: 2 },
  { wait: 8, shrink: 18, from: 1250, to: 780, dps: 4 },
  { wait: 6, shrink: 15, from: 780, to: 450, dps: 6 },
  { wait: 5, shrink: 12, from: 450, to: 200, dps: 9 },
  { wait: 4, shrink: 10, from: 200, to: 70, dps: 13 },
];

const AI_NAMES = [
  "夜鹰",
  "老六",
  "平底锅",
  "伏地魔",
  "空投哥",
  "98K",
  "三级头",
  "伏击者",
  "决赛圈",
  "毒圈猎人",
  "独狼",
  "闪光弹",
  "雨林客",
  "铁憨憨",
  "沙漠狐",
  "渡鸦",
  "钢枪王",
  "苟到决赛",
  "枪线",
  "缩圈幸运星",
];

const AI_COLORS = [
  "#f97316",
  "#ef4444",
  "#eab308",
  "#a855f7",
  "#f43f5e",
  "#38bdf8",
  "#fb7185",
  "#c084fc",
  "#facc15",
  "#f472b6",
];

const NO_EVENTS: BattleEvent[] = [];

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

function wrapAngle(delta: number): number {
  let d = delta % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function turnToward(current: number, target: number, maxStep: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/** 线段与圆求交，返回 [0,1] 内最近的 t；无交返回 -1 */
function segmentCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  radius: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-8) {
    return fx * fx + fy * fy <= radius * radius ? 0 : -1;
  }
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + root) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

/** 线段与轴对齐矩形求交（slab 法） */
function segmentRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  if (Math.abs(dx) < 1e-8) {
    if (x1 < minX || x1 > maxX) return -1;
  } else {
    let ta = (minX - x1) / dx;
    let tb = (maxX - x1) / dx;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }

  if (Math.abs(dy) < 1e-8) {
    if (y1 < minY || y1 > maxY) return -1;
  } else {
    let ta = (minY - y1) / dy;
    let tb = (maxY - y1) / dy;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }

  return t0;
}

export class BattleEngine {
  readonly obstacles: Obstacle[] = [];
  readonly fighters: Fighter[] = [];
  readonly bullets: Bullet[] = [];
  readonly particles: Particle[] = [];
  readonly pickups: Pickup[] = [];
  readonly player: Fighter;
  readonly zone: ZoneState = {
    radius: ZONE_STAGES[0].from,
    targetRadius: ZONE_STAGES[0].to,
    dps: ZONE_STAGES[0].dps,
    phase: 0,
    shrinking: false,
    timeLeft: ZONE_STAGES[0].wait,
    final: false,
  };

  aliveCount = 0;
  elapsed = 0;
  over = false;
  result: BattleResult | null = null;
  shake = 0;

  private events: BattleEvent[] = [];
  private zoneTime = 0;
  private bulletCursor = 0;
  private particleCursor = 0;
  private pickupCursor = 0;
  private emptyCooldown = 0;

  constructor(playerArmor: number) {
    this.buildObstacles();
    this.player = this.spawnPlayer(playerArmor);
    this.fighters.push(this.player);
    this.aliveCount = 1;

    for (let i = 1; i < PLAYER_COUNT; i += 1) {
      const skill = 0.2 + Math.random() * 0.75;
      const armorOptions = [0, 0, 25, 50];
      const armor = armorOptions[Math.floor(Math.random() * armorOptions.length)];
      const name = AI_NAMES[(i - 1) % AI_NAMES.length];
      const color = AI_COLORS[(i - 1) % AI_COLORS.length];
      const fighter = this.createFighter(i, name, false, color, armor, skill);
      this.fighters.push(fighter);
      this.aliveCount += 1;
    }

    for (let i = 0; i < BULLET_POOL; i += 1) {
      this.bullets.push({
        active: false,
        x: 0,
        y: 0,
        px: 0,
        py: 0,
        vx: 0,
        vy: 0,
        ownerId: -1,
        damage: 0,
        range: 0,
        traveled: 0,
        fromPlayer: false,
      });
    }
    for (let i = 0; i < PARTICLE_POOL; i += 1) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 2,
        color: "#fff",
      });
    }
    for (let i = 0; i < PICKUP_POOL; i += 1) {
      this.pickups.push({ active: false, kind: "ammo", x: 0, y: 0, amount: PICKUP_AMMO, life: 0 });
    }
    this.scatterInitialPickups();
  }

  /* ------------------------------------------------------------------ */
  /* 对外 API                                                             */
  /* ------------------------------------------------------------------ */

  step(dt: number, input: StepInput): void {
    if (this.over) return;

    this.elapsed += dt;
    this.zoneTime += dt;
    this.shake = Math.max(0, this.shake - dt * 16);
    this.emptyCooldown = Math.max(0, this.emptyCooldown - dt);

    this.updateZone();
    this.updateTimers(dt);
    this.applyZoneDamage(dt);

    if (this.elapsed >= MATCH_SECONDS) {
      this.finish("timeout");
      return;
    }
    if (this.over) return;

    if (this.player.alive) this.updatePlayer(dt, input);
    for (let i = 1; i < this.fighters.length; i += 1) {
      const fighter = this.fighters[i];
      if (!fighter.alive) continue;
      this.updateAi(fighter, dt);
      if (this.over) return;
    }

    this.separateFighters();
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updatePickups(dt);

    if (!this.over && this.player.alive && this.aliveCount === 1) {
      this.finish("win");
    }
  }

  playerReload(): void {
    if (this.over || !this.player.alive) return;
    this.startReload(this.player);
  }

  getHud(): BattleHud {
    const p = this.player;
    const dx = p.x - ZONE_CENTER;
    const dy = p.y - ZONE_CENTER;
    const outside = p.alive && Math.hypot(dx, dy) > this.zone.radius;
    return {
      hp: Math.max(0, Math.ceil(p.hp)),
      maxHp: 100,
      armor: Math.max(0, Math.ceil(p.armor)),
      maxArmor: p.maxArmor,
      mag: p.mag,
      reserve: p.reserve,
      reloading: p.reloadTimer > 0,
      reloadProgress:
        p.reloadTimer > 0 ? clamp(1 - p.reloadTimer / RELOAD_SECONDS, 0, 1) : 1,
      alive: this.aliveCount,
      total: PLAYER_COUNT,
      kills: p.kills,
      timeLeft: Math.max(0, MATCH_SECONDS - this.elapsed),
      elapsed: this.elapsed,
      zone: {
        radius: this.zone.radius,
        dps: this.zone.dps,
        phase: this.zone.phase,
        shrinking: this.zone.shrinking,
        timeLeft: this.zone.timeLeft,
        final: this.zone.final,
      },
      outside,
      damageRate: this.zone.dps * Math.min(3, 1 + p.outsideTimer / 18),
    };
  }

  takeEvents(): BattleEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 世界生成                                                             */
  /* ------------------------------------------------------------------ */

  private buildObstacles(): void {
    const specs: { kind: ObstacleKind; count: number; min: number; max: number }[] = [
      { kind: "crate", count: 24, min: 20, max: 32 },
      { kind: "tree", count: 30, min: 28, max: 48 },
    ];

    for (const spec of specs) {
      for (let i = 0; i < spec.count; i += 1) {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const r = spec.min + Math.random() * (spec.max - spec.min);
          const margin = r + 90;
          const x = margin + Math.random() * (WORLD_SIZE - margin * 2);
          const y = margin + Math.random() * (WORLD_SIZE - margin * 2);
          if (Math.hypot(x - ZONE_CENTER, y - ZONE_CENTER) < r + 260) continue;
          let ok = true;
          for (const other of this.obstacles) {
            const minGap = r + other.r + 70;
            const ddx = x - other.x;
            const ddy = y - other.y;
            if (ddx * ddx + ddy * ddy < minGap * minGap) {
              ok = false;
              break;
            }
          }
          if (ok) {
            this.obstacles.push({ kind: spec.kind, x, y, r });
            break;
          }
        }
      }
    }
  }

  private spawnPlayer(armor: number): Fighter {
    const safeArmor = clamp(armor, 0, 100);
    const spot = this.findSpawn(0);
    const player = this.createFighter(0, "你", true, "#2dd4bf", safeArmor, 1, spot.x, spot.y);
    player.speed = 245 - safeArmor * 0.25;
    return player;
  }

  private createFighter(
    id: number,
    name: string,
    isPlayer: boolean,
    color: string,
    armor: number,
    skill: number,
    spawnX?: number,
    spawnY?: number,
  ): Fighter {
    const spot = spawnX === undefined ? this.findSpawn(420) : { x: spawnX, y: spawnY ?? 0 };
    const safeArmor = clamp(armor, 0, 100);
    return {
      id,
      name,
      isPlayer,
      x: spot.x,
      y: spot.y,
      angle: Math.random() * TAU,
      hp: 100,
      armor: safeArmor,
      maxArmor: safeArmor,
      alive: true,
      color,
      speed: isPlayer ? 245 - safeArmor * 0.25 : 180 + skill * 42 - safeArmor * 0.15,
      mag: MAG_SIZE,
      reserve: isPlayer ? RESERVE_AMMO : 900,
      reloadTimer: 0,
      fireCooldown: 0.4 + Math.random() * 0.6,
      muzzle: 0,
      hitFlash: 0,
      deadAt: 0,
      kills: 0,
      state: "wander",
      targetId: -1,
      decisionTimer: 0.1 + Math.random() * 0.4,
      reaction: 0,
      strafe: Math.random() < 0.5 ? -1 : 1,
      skill,
      wanderX: spot.x,
      wanderY: spot.y,
      wanderTimer: 0,
      lastAttackerId: -1,
      attackerTimer: 0,
      outsideTimer: 0,
    };
  }

  private findSpawn(minDistance: number): { x: number; y: number } {
    const margin = 150;
    let bestX = ZONE_CENTER;
    let bestY = ZONE_CENTER;
    let bestScore = -1;

    // 最佳候选采样：在随机点里挑离已有单位最远的，避免最后几个 AI 挤在一起
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const x = margin + Math.random() * (WORLD_SIZE - margin * 2);
      const y = margin + Math.random() * (WORLD_SIZE - margin * 2);
      if (!this.isFree(x, y, FIGHTER_RADIUS + 18)) continue;
      let nearest = WORLD_SIZE;
      for (const other of this.fighters) {
        const dx = x - other.x;
        const dy = y - other.y;
        const d = Math.hypot(dx, dy);
        if (d < nearest) nearest = d;
      }
      if (nearest >= minDistance) return { x, y };
      if (nearest > bestScore) {
        bestScore = nearest;
        bestX = x;
        bestY = y;
      }
    }

    if (bestScore >= 0) return { x: bestX, y: bestY };

    // 兜底：地图中心附近找一个不与障碍重叠的位置
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const angle = Math.random() * TAU;
      const radius = Math.random() * 700;
      const x = ZONE_CENTER + Math.cos(angle) * radius;
      const y = ZONE_CENTER + Math.sin(angle) * radius;
      if (this.isFree(x, y, FIGHTER_RADIUS + 18)) return { x, y };
    }
    return { x: ZONE_CENTER, y: ZONE_CENTER };
  }

  private isFree(x: number, y: number, radius: number): boolean {
    if (
      x < radius + 30 ||
      x > WORLD_SIZE - radius - 30 ||
      y < radius + 30 ||
      y > WORLD_SIZE - radius - 30
    ) {
      return false;
    }
    for (const o of this.obstacles) {
      if (o.kind === "tree") {
        const dx = x - o.x;
        const dy = y - o.y;
        const min = radius + o.r + 6;
        if (dx * dx + dy * dy < min * min) return false;
      } else {
        const nearestX = clamp(x, o.x - o.r, o.x + o.r);
        const nearestY = clamp(y, o.y - o.r, o.y + o.r);
        const dx = x - nearestX;
        const dy = y - nearestY;
        if (dx * dx + dy * dy < (radius + 6) * (radius + 6)) return false;
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 毒圈                                                                 */
  /* ------------------------------------------------------------------ */

  private updateZone(): void {
    let t = this.zoneTime;
    let radius = ZONE_STAGES[ZONE_STAGES.length - 1].to;
    let target = radius;
    let dps = 16;
    let phase = ZONE_STAGES.length - 1;
    let shrinking = false;
    let timeLeft = 0;
    let broken = false;

    for (let i = 0; i < ZONE_STAGES.length; i += 1) {
      const stage = ZONE_STAGES[i];
      if (t < stage.wait) {
        radius = stage.from;
        target = stage.to;
        dps = stage.dps;
        phase = i;
        shrinking = false;
        timeLeft = stage.wait - t;
        broken = true;
        break;
      }
      t -= stage.wait;
      if (t < stage.shrink) {
        const k = t / stage.shrink;
        radius = stage.from + (stage.to - stage.from) * k;
        target = stage.to;
        dps = stage.dps;
        phase = i;
        shrinking = true;
        timeLeft = stage.shrink - t;
        broken = true;
        break;
      }
      t -= stage.shrink;
      radius = stage.to;
      target = stage.to;
      dps = stage.dps;
      phase = i;
    }

    if (!broken) {
      radius = ZONE_STAGES[ZONE_STAGES.length - 1].to;
      target = radius;
      dps = 16;
      phase = ZONE_STAGES.length - 1;
    }

    this.zone.radius = radius;
    this.zone.targetRadius = target;
    this.zone.dps = dps;
    this.zone.phase = phase;
    this.zone.shrinking = shrinking;
    this.zone.timeLeft = timeLeft;
    this.zone.final = !broken;
  }

  private applyZoneDamage(dt: number): void {
    const zone = this.zone;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const dist = Math.hypot(f.x - ZONE_CENTER, f.y - ZONE_CENTER);
      if (dist > zone.radius) {
        f.outsideTimer += dt;
        const dps = zone.dps * Math.min(3, 1 + f.outsideTimer / 18);
        f.hp -= dps * dt;
        if (f.hp <= 0) {
          f.hp = 0;
          this.killFighter(f, -1);
          if (this.over) return;
        }
      } else if (f.outsideTimer > 0) {
        f.outsideTimer = Math.max(0, f.outsideTimer - dt * 2.5);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 计时器 / 玩家                                                        */
  /* ------------------------------------------------------------------ */

  private updateTimers(dt: number): void {
    for (const f of this.fighters) {
      f.fireCooldown = Math.max(0, f.fireCooldown - dt);
      f.muzzle = Math.max(0, f.muzzle - dt);
      f.hitFlash = Math.max(0, f.hitFlash - dt);
      if (!f.alive) continue;
      if (f.reloadTimer > 0) {
        f.reloadTimer -= dt;
        if (f.reloadTimer <= 0) {
          f.reloadTimer = 0;
          const need = MAG_SIZE - f.mag;
          const take = Math.min(need, f.reserve);
          f.mag += take;
          f.reserve -= take;
          if (f.isPlayer) this.events.push({ type: "reload-done" });
        }
      }
    }
  }

  private updatePlayer(dt: number, input: StepInput): void {
    const p = this.player;
    const len = Math.hypot(input.moveX, input.moveY);
    if (len > 0.001) {
      const speed = p.speed;
      this.moveFighter(
        p,
        (input.moveX / len) * speed * dt,
        (input.moveY / len) * speed * dt,
      );
    }
    p.angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);

    if (!input.firing || p.reloadTimer > 0) return;
    if (p.mag <= 0) {
      if (p.reserve > 0) {
        this.startReload(p);
      } else if (this.emptyCooldown <= 0) {
        this.events.push({ type: "empty" });
        this.emptyCooldown = 1.2;
      }
      return;
    }
    this.fire(p, p.angle, (Math.random() - 0.5) * 0.035, 16, 1180, 900, 0.17);
  }

  private startReload(f: Fighter): void {
    if (f.reloadTimer > 0 || f.mag >= MAG_SIZE || f.reserve <= 0 || !f.alive) return;
    f.reloadTimer = RELOAD_SECONDS;
    if (f.isPlayer) this.events.push({ type: "reload" });
  }

  private fire(
    f: Fighter,
    angle: number,
    spread: number,
    damage: number,
    speed: number,
    range: number,
    cooldown: number,
  ): void {
    if (f.reloadTimer > 0 || f.fireCooldown > 0 || f.mag <= 0) return;
    f.mag -= 1;
    f.fireCooldown = cooldown;
    f.muzzle = 0.06;
    const actual = angle + spread;
    this.spawnBullet(f, actual, damage, speed, range);
    if (f.isPlayer) {
      this.events.push({ type: "shot" });
      this.shake = Math.min(5, this.shake + 0.8);
    }
    if (f.mag === 0) this.startReload(f);
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                   */
  /* ------------------------------------------------------------------ */

  private updateAi(f: Fighter, dt: number): void {
    f.decisionTimer -= dt;
    f.wanderTimer -= dt;
    if (f.attackerTimer > 0) {
      f.attackerTimer -= dt;
      if (f.attackerTimer <= 0) f.lastAttackerId = -1;
    }
    if (f.mag <= 0 && f.reloadTimer <= 0) this.startReload(f);
    if (f.decisionTimer <= 0) {
      f.decisionTimer = 0.3 + Math.random() * 0.2;
      this.decideAi(f);
    }

    const distCenter = Math.hypot(f.x - ZONE_CENTER, f.y - ZONE_CENTER);
    const outside = distCenter > this.zone.radius - 30;
    let dirX = 0;
    let dirY = 0;

    if (outside) {
      const dx = ZONE_CENTER - f.x;
      const dy = ZONE_CENTER - f.y;
      const d = Math.hypot(dx, dy) || 1;
      dirX = dx / d;
      dirY = dy / d;
      f.angle = turnToward(f.angle, Math.atan2(dy, dx), 7 * dt);
    } else if (f.state === "hunt") {
      const target = this.fighters[f.targetId];
      if (!target || !target.alive || target === f) {
        f.state = "wander";
        f.targetId = -1;
      } else {
        const dx = target.x - f.x;
        const dy = target.y - f.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;

        if (dist > 340) {
          dirX = ux;
          dirY = uy;
        } else if (dist < 150) {
          dirX = -ux;
          dirY = -uy;
        } else {
          dirX = -uy * f.strafe;
          dirY = ux * f.strafe;
        }

        const aim = Math.atan2(dy, dx);
        f.angle = turnToward(f.angle, aim, (5 + f.skill * 4) * dt);
        if (f.reaction > 0) f.reaction -= dt;

        if (f.reaction <= 0 && dist < 520 && f.mag > 0 && f.reloadTimer <= 0) {
          const diff = Math.abs(wrapAngle(aim - f.angle));
          if (diff < 0.22) {
            const spread =
              (Math.random() - 0.5) *
              (0.08 + (1 - f.skill) * 0.16 + dist * 0.0002);
            this.fire(
              f,
              f.angle,
              spread,
              10,
              980,
              780,
              0.55 + (1 - f.skill) * 0.3,
            );
          }
        }
      }
    } else {
      const dx = f.wanderX - f.x;
      const dy = f.wanderY - f.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 45 && f.wanderTimer > 0) {
        dirX = dx / dist;
        dirY = dy / dist;
        f.angle = turnToward(f.angle, Math.atan2(dy, dx), 5 * dt);
      } else {
        f.wanderTimer = 0;
      }
    }

    if (dirX === 0 && dirY === 0) return;

    // 简单避障：探测前方，被挡住时沿垂直方向绕行
    if (this.isBlocked(f.x + dirX * 58, f.y + dirY * 58, 13)) {
      const side = f.strafe >= 0 ? 1 : -1;
      const rx = -dirY * side;
      const ry = dirX * side;
      if (!this.isBlocked(f.x + rx * 58, f.y + ry * 58, 13)) {
        dirX = rx;
        dirY = ry;
      } else {
        dirX = -dirX;
        dirY = -dirY;
      }
    }

    const len = Math.hypot(dirX, dirY) || 1;
    this.moveFighter(f, (dirX / len) * f.speed * dt, (dirY / len) * f.speed * dt);
  }

  private decideAi(f: Fighter): void {
    const distCenter = Math.hypot(f.x - ZONE_CENTER, f.y - ZONE_CENTER);
    if (distCenter > this.zone.radius - 30) {
      f.state = "zone";
      f.targetId = -1;
      return;
    }

    // 开局 4 秒「落地缓冲」：AI 只游走，不主动锁敌，给玩家观察局势的时间
    if (this.elapsed < 4) {
      f.state = "wander";
      f.targetId = -1;
      const waypointDist = Math.hypot(f.wanderX - f.x, f.wanderY - f.y);
      if (f.wanderTimer <= 0 || waypointDist < 70) {
        this.chooseWanderPoint(f);
      }
      return;
    }

    let bestId = -1;
    let bestDist = 480 * 480;

    const attacker = f.lastAttackerId >= 0 ? this.fighters[f.lastAttackerId] : null;
    if (attacker && attacker.alive && attacker !== f) {
      const dx = attacker.x - f.x;
      const dy = attacker.y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1000 * 1000) {
        bestId = attacker.id;
        bestDist = d2;
      }
    }

    if (bestId < 0) {
      for (const other of this.fighters) {
        if (other === f || !other.alive) continue;
        const dx = other.x - f.x;
        const dy = other.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= bestDist) continue;
        if (!this.hasLineOfSight(f.x, f.y, other.x, other.y)) continue;
        bestId = other.id;
        bestDist = d2;
      }
    }

    if (bestId >= 0) {
      if (f.targetId !== bestId) {
        f.reaction = 0.25 + (1 - f.skill) * 0.45;
        f.strafe = Math.random() < 0.5 ? -1 : 1;
      }
      f.targetId = bestId;
      f.state = "hunt";
      return;
    }

    f.targetId = -1;
    f.state = "wander";
    const waypointDist = Math.hypot(f.wanderX - f.x, f.wanderY - f.y);
    if (f.wanderTimer <= 0 || waypointDist < 70) {
      this.chooseWanderPoint(f);
    }
  }

  private chooseWanderPoint(f: Fighter): void {
    const point = this.randomWaypoint();
    f.wanderX = point.x;
    f.wanderY = point.y;
    f.wanderTimer = 6;
    if (Math.random() < 0.4) f.strafe = -f.strafe;
  }

  private randomWaypoint(): { x: number; y: number } {
    const maxR = Math.min(this.zone.radius * 0.85, 1050);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = Math.random() * TAU;
      const radius = Math.sqrt(Math.random()) * maxR;
      const x = ZONE_CENTER + Math.cos(angle) * radius;
      const y = ZONE_CENTER + Math.sin(angle) * radius;
      if (this.isFree(x, y, FIGHTER_RADIUS + 10)) return { x, y };
    }
    return { x: ZONE_CENTER, y: ZONE_CENTER };
  }

  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    for (const o of this.obstacles) {
      if (o.kind === "tree") {
        if (segmentCircle(x1, y1, x2, y2, o.x, o.y, o.r) >= 0) return false;
      } else {
        if (
          segmentRect(
            x1,
            y1,
            x2,
            y2,
            o.x - o.r,
            o.y - o.r,
            o.x + o.r,
            o.y + o.r,
          ) >= 0
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private isBlocked(x: number, y: number, radius: number): boolean {
    if (
      x < radius + 20 ||
      x > WORLD_SIZE - radius - 20 ||
      y < radius + 20 ||
      y > WORLD_SIZE - radius - 20
    ) {
      return true;
    }
    for (const o of this.obstacles) {
      if (o.kind === "tree") {
        const dx = x - o.x;
        const dy = y - o.y;
        if (dx * dx + dy * dy < (radius + o.r) * (radius + o.r)) return true;
      } else {
        const nearestX = clamp(x, o.x - o.r, o.x + o.r);
        const nearestY = clamp(y, o.y - o.r, o.y + o.r);
        const dx = x - nearestX;
        const dy = y - nearestY;
        if (dx * dx + dy * dy < radius * radius) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* 移动与碰撞                                                           */
  /* ------------------------------------------------------------------ */

  private moveFighter(f: Fighter, dx: number, dy: number): void {
    f.x += dx;
    this.resolveCollisions(f);
    f.y += dy;
    this.resolveCollisions(f);
    f.x = clamp(f.x, FIGHTER_RADIUS + 16, WORLD_SIZE - FIGHTER_RADIUS - 16);
    f.y = clamp(f.y, FIGHTER_RADIUS + 16, WORLD_SIZE - FIGHTER_RADIUS - 16);
  }

  private resolveCollisions(f: Fighter): void {
    for (const o of this.obstacles) {
      if (o.kind === "tree") {
        const dx = f.x - o.x;
        const dy = f.y - o.y;
        const min = o.r + FIGHTER_RADIUS;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min) {
          const d = Math.sqrt(d2);
          if (d > 0.001) {
            f.x = o.x + (dx / d) * min;
            f.y = o.y + (dy / d) * min;
          } else {
            f.x = o.x + min;
          }
        }
      } else {
        const nearestX = clamp(f.x, o.x - o.r, o.x + o.r);
        const nearestY = clamp(f.y, o.y - o.r, o.y + o.r);
        const dx = f.x - nearestX;
        const dy = f.y - nearestY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= FIGHTER_RADIUS * FIGHTER_RADIUS) continue;

        if (d2 > 0.001) {
          const d = Math.sqrt(d2);
          const push = FIGHTER_RADIUS - d;
          f.x += (dx / d) * push;
          f.y += (dy / d) * push;
        } else {
          // 圆心陷在箱子里：推向最近的边
          const left = f.x - (o.x - o.r);
          const right = o.x + o.r - f.x;
          const top = f.y - (o.y - o.r);
          const bottom = o.y + o.r - f.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) f.x = o.x - o.r - FIGHTER_RADIUS;
          else if (m === right) f.x = o.x + o.r + FIGHTER_RADIUS;
          else if (m === top) f.y = o.y - o.r - FIGHTER_RADIUS;
          else f.y = o.y + o.r + FIGHTER_RADIUS;
        }
      }
    }
  }

  private separateFighters(): void {
    const minDist = FIGHTER_RADIUS * 2;
    for (let i = 0; i < this.fighters.length; i += 1) {
      const a = this.fighters[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.fighters.length; j += 1) {
        const b = this.fighters[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist) continue;
        const d = Math.sqrt(d2);
        if (d < 0.001) {
          a.x -= 1;
          b.x += 1;
          continue;
        }
        const push = (minDist - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
    for (const f of this.fighters) {
      if (f.alive) this.resolveCollisions(f);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 子弹 / 伤害 / 击杀                                                   */
  /* ------------------------------------------------------------------ */

  private spawnBullet(
    owner: Fighter,
    angle: number,
    damage: number,
    speed: number,
    range: number,
  ): void {
    const bullet = this.acquireBullet();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    bullet.active = true;
    bullet.x = owner.x + cos * 22;
    bullet.y = owner.y + sin * 22;
    bullet.px = bullet.x;
    bullet.py = bullet.y;
    bullet.vx = cos * speed;
    bullet.vy = sin * speed;
    bullet.ownerId = owner.id;
    bullet.damage = damage;
    bullet.range = range;
    bullet.traveled = 0;
    bullet.fromPlayer = owner.isPlayer;

    this.spawnParticles(bullet.x, bullet.y, 2, 0.06, owner.isPlayer ? "#fef3c7" : "#fdba74", 60, 0.16);
  }

  private acquireBullet(): Bullet {
    for (let i = 0; i < BULLET_POOL; i += 1) {
      const index = (this.bulletCursor + i) % BULLET_POOL;
      const bullet = this.bullets[index];
      if (!bullet.active) {
        this.bulletCursor = (index + 1) % BULLET_POOL;
        return bullet;
      }
    }
    const bullet = this.bullets[this.bulletCursor];
    this.bulletCursor = (this.bulletCursor + 1) % BULLET_POOL;
    return bullet;
  }

  private updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.active) continue;
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      let bestT = 2;
      let hitFighter: Fighter | null = null;
      let blocked = false;

      for (const f of this.fighters) {
        if (!f.alive || f.id === b.ownerId) continue;
        const t = segmentCircle(b.x, b.y, nx, ny, f.x, f.y, FIGHTER_RADIUS);
        if (t >= 0 && t < bestT) {
          bestT = t;
          hitFighter = f;
          blocked = false;
        }
      }

      for (const o of this.obstacles) {
        const t =
          o.kind === "tree"
            ? segmentCircle(b.x, b.y, nx, ny, o.x, o.y, o.r)
            : segmentRect(
                b.x,
                b.y,
                nx,
                ny,
                o.x - o.r,
                o.y - o.r,
                o.x + o.r,
                o.y + o.r,
              );
        if (t >= 0 && t < bestT) {
          bestT = t;
          hitFighter = null;
          blocked = true;
        }
      }

      if (hitFighter) {
        b.x += (nx - b.x) * bestT;
        b.y += (ny - b.y) * bestT;
        b.active = false;
        const hitPlayer = hitFighter.isPlayer;
        this.spawnParticles(
          b.x,
          b.y,
          hitPlayer ? 7 : 5,
          0.18,
          hitPlayer ? "#fecaca" : "#fca5a5",
          150,
          0.4,
        );
        this.damageFighter(hitFighter, b.damage, b.ownerId, b.fromPlayer);
      } else if (blocked) {
        b.x += (nx - b.x) * bestT;
        b.y += (ny - b.y) * bestT;
        b.active = false;
        this.spawnParticles(b.x, b.y, 3, 0.1, "#fde68a", 110, 0.3);
      } else {
        b.px = b.x;
        b.py = b.y;
        b.x = nx;
        b.y = ny;
        b.traveled += Math.hypot(b.vx, b.vy) * dt;
        if (b.traveled >= b.range) {
          b.active = false;
        }
      }

      if (this.over) return;
    }
  }

  private damageFighter(
    target: Fighter,
    amount: number,
    attackerId: number,
    fromPlayer: boolean,
  ): void {
    if (!target.alive || this.over) return;
    let damage = amount;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, damage * 0.55);
      target.armor -= absorbed;
      damage -= absorbed;
    }
    target.hp -= damage;
    target.hitFlash = 0.12;
    if (attackerId >= 0) {
      target.lastAttackerId = attackerId;
      target.attackerTimer = 4;
    }
    if (target.isPlayer) {
      this.events.push({ type: "hurt" });
      this.shake = Math.min(8, this.shake + 1.8);
    } else if (fromPlayer) {
      this.events.push({ type: "hit" });
    }
    if (target.hp <= 0) {
      target.hp = 0;
      this.killFighter(target, attackerId);
    }
  }

  private killFighter(victim: Fighter, killerId: number): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deadAt = this.elapsed;
    victim.reloadTimer = 0;
    victim.targetId = -1;
    this.aliveCount = Math.max(0, this.aliveCount - 1);

    const killer = killerId >= 0 ? this.fighters[killerId] : null;
    if (killer) killer.kills += 1;

    const playerKill = killerId === 0;
    let text: string;
    let tone: FeedTone;
    if (playerKill) {
      text = `你 淘汰了 ${victim.name}`;
      tone = "player-kill";
      this.events.push({ type: "kill" });
    } else if (victim.isPlayer) {
      text = `${killer ? killer.name : "毒圈"} 淘汰了你`;
      tone = "player-death";
    } else if (!killer) {
      text = `${victim.name} 被毒圈吞没`;
      tone = "zone";
    } else {
      text = `${killer.name} 淘汰了 ${victim.name}`;
      tone = "other";
    }
    this.events.push({ type: "feed", text, tone });

    this.spawnParticles(
      victim.x,
      victim.y,
      14,
      0.35,
      victim.isPlayer ? "#fda4af" : "#f87171",
      180,
      0.6,
    );

    if (!victim.isPlayer) {
      const kind: PickupKind = Math.random() < PICKUP_MED_CHANCE ? "med" : "ammo";
      this.dropLoot(victim.x, victim.y, kind);
    }

    if (victim.isPlayer) {
      this.finish("dead");
      return;
    }
    if (this.player.alive && this.aliveCount === 1) {
      this.finish("win");
    }
  }

  /* ------------------------------------------------------------------ */
  /* 粒子                                                                 */
  /* ------------------------------------------------------------------ */

  private spawnParticles(
    x: number,
    y: number,
    count: number,
    spread: number,
    color: string,
    speed: number,
    life: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const p = this.acquireParticle();
      const angle = Math.random() * TAU;
      const v = speed * (0.35 + Math.random() * 0.65);
      p.active = true;
      p.x = x + (Math.random() - 0.5) * spread * 20;
      p.y = y + (Math.random() - 0.5) * spread * 20;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.life = life * (0.6 + Math.random() * 0.6);
      p.maxLife = p.life;
      p.size = 1.5 + Math.random() * 2.2;
      p.color = color;
    }
  }

  private acquireParticle(): Particle {
    for (let i = 0; i < PARTICLE_POOL; i += 1) {
      const index = (this.particleCursor + i) % PARTICLE_POOL;
      const particle = this.particles[index];
      if (!particle.active) {
        this.particleCursor = (index + 1) % PARTICLE_POOL;
        return particle;
      }
    }
    const particle = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL;
    return particle;
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 弹药补给                                                             */
  /* ------------------------------------------------------------------ */

  private dropLoot(x: number, y: number, kind: PickupKind): void {
    // 只在玩家附近掉落，远处 AI 互殴不会堆一地盒子
    if (Math.hypot(x - this.player.x, y - this.player.y) > 900) return;
    this.spawnPickupAt(x, y, kind);
  }

  /** 在指定位置放一个补给（弹药箱或医疗包） */
  private spawnPickupAt(x: number, y: number, kind: PickupKind): void {
    let pickup: Pickup | null = null;
    for (let i = 0; i < PICKUP_POOL; i += 1) {
      const index = (this.pickupCursor + i) % PICKUP_POOL;
      if (!this.pickups[index].active) {
        pickup = this.pickups[index];
        this.pickupCursor = (index + 1) % PICKUP_POOL;
        break;
      }
    }
    if (!pickup) {
      pickup = this.pickups[this.pickupCursor];
      this.pickupCursor = (this.pickupCursor + 1) % PICKUP_POOL;
    }
    pickup.active = true;
    pickup.x = x + (Math.random() - 0.5) * 18;
    pickup.y = y + (Math.random() - 0.5) * 18;
    pickup.kind = kind;
    pickup.amount = kind === "med" ? PICKUP_HEAL : PICKUP_AMMO;
    pickup.life = PICKUP_LIFE;
  }

  /** 开局在地图上撒一批补给，避免只能靠击杀掉落 */
  private scatterInitialPickups(): void {
    const margin = 260;
    const span = WORLD_SIZE - margin * 2;
    for (let i = 0; i < INITIAL_AMMO_CRATES; i += 1) {
      this.spawnPickupAt(margin + Math.random() * span, margin + Math.random() * span, "ammo");
    }
    for (let i = 0; i < INITIAL_MED_KITS; i += 1) {
      this.spawnPickupAt(margin + Math.random() * span, margin + Math.random() * span, "med");
    }
  }

  private updatePickups(dt: number): void {
    const player = this.player;
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      pickup.life -= dt;
      if (pickup.life <= 0) {
        pickup.active = false;
        continue;
      }
      if (!player.alive) continue;
      const isMed = pickup.kind === "med";
      if (isMed) {
        if (player.hp >= MAX_HP) continue;
      } else if (player.reserve >= RESERVE_CAP) {
        continue;
      }
      const dx = pickup.x - player.x;
      const dy = pickup.y - player.y;
      if (dx * dx + dy * dy > 34 * 34) continue;

      if (isMed) {
        const heal = Math.min(pickup.amount, MAX_HP - player.hp);
        if (heal <= 0) continue;
        pickup.active = false;
        player.hp += heal;
        this.events.push({
          type: "feed",
          text: `拾取 医疗包 +${heal} HP`,
          tone: "loot",
        });
        this.events.push({ type: "pickup" });
        continue;
      }

      const gained = Math.min(pickup.amount, RESERVE_CAP - player.reserve);
      if (gained <= 0) continue;
      pickup.active = false;
      player.reserve += gained;
      this.events.push({
        type: "feed",
        text: `拾取 5.56 弹药 +${gained}`,
        tone: "loot",
      });
      this.events.push({ type: "pickup" });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 结束                                                                 */
  /* ------------------------------------------------------------------ */

  private finish(reason: BattleResultReason): void {
    if (this.over) return;
    this.over = true;
    const rank = reason === "dead" ? this.aliveCount + 1 : this.aliveCount;
    this.result = {
      win: reason === "win",
      rank: clamp(rank, 1, PLAYER_COUNT),
      total: PLAYER_COUNT,
      kills: this.player.kills,
      survived: this.elapsed,
      reason,
    };
    this.events.push({
      type: "feed",
      text:
        reason === "win"
          ? "大吉大利，今晚吃鸡！"
          : reason === "timeout"
            ? "时间到，按剩余人数结算"
            : "你被淘汰了",
      tone: reason === "win" ? "player-kill" : "player-death",
    });
  }
}
