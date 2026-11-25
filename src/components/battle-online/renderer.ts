/**
 * 在线对战 · 精简 Canvas 渲染器（独立于单机吃鸡 engine/renderer）
 *
 * 只做「把插值后的快照画出来」，消费 OnlineRenderer.addTracer / addDamage 等瞬时特效。
 * 绘制以本地玩家为相机中心；世界坐标 → 屏幕坐标用一次 translate 完成。
 */

import {
  PLAYER_RADIUS,
  SHRINK_START_SECONDS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONE_START_RADIUS,
  type MatchPhase,
  type NetPlayer,
  type NetZone,
} from "./protocol";

const TAU = Math.PI * 2;
const FONT = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
const GRID_STEP = 100;

const PLAYER_COLORS = [
  "#f97316",
  "#a78bfa",
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#4ade80",
  "#fb7185",
  "#22d3ee",
];

export type RenderFrame = {
  players: NetPlayer[];
  zone: NetZone;
  selfId: string;
  phase: MatchPhase;
  camera: { x: number; y: number };
  aim: number;
  firing: boolean;
  pointer: { x: number; y: number; inside: boolean };
  selfAlive: boolean;
  outside: boolean;
};

type Tracer = {
  x: number;
  y: number;
  aim: number;
  life: number;
  maxLife: number;
  self: boolean;
};

type FloatText = {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PLAYER_COLORS[hash % PLAYER_COLORS.length];
}

export class OnlineRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  private tracers: Tracer[] = [];
  private texts: FloatText[] = [];
  private hitFlashes = new Map<string, number>();
  private screenFlash = 0;
  private shake = 0;

  private vignette: CanvasGradient | null = null;
  private vignetteKey = "";
  private dangerGlow: CanvasGradient | null = null;
  private dangerKey = "";

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器不支持 Canvas 2D");
    this.canvas = canvas;
    this.ctx = ctx;
  }

  addTracer(x: number, y: number, aim: number, self: boolean): void {
    this.tracers.push({ x, y, aim, life: 0.14, maxLife: 0.14, self });
    if (this.tracers.length > 24) this.tracers.shift();
  }

  addDamage(x: number, y: number, amount: number): void {
    this.texts.push({
      x,
      y: y - 26,
      text: `-${Math.round(amount)}`,
      color: "#fecdd3",
      life: 0.85,
      maxLife: 0.85,
    });
    if (this.texts.length > 16) this.texts.shift();
  }

  markHit(playerId: string): void {
    this.hitFlashes.set(playerId, performance.now() + 140);
  }

  addHitFlash(): void {
    this.screenFlash = 0.3;
    this.shake = 8;
  }

  render(frame: RenderFrame, dt: number): void {
    this.syncSize();
    const { ctx } = this;
    const width = this.cssWidth;
    const height = this.cssHeight;
    if (width <= 0 || height <= 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#061219";
    ctx.fillRect(0, 0, width, height);

    this.updateEffects(dt);

    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const camX = frame.camera.x;
    const camY = frame.camera.y;

    const left = camX - width / 2 - 80;
    const top = camY - height / 2 - 80;
    const right = camX + width / 2 + 80;
    const bottom = camY + height / 2 + 80;

    ctx.save();
    ctx.translate(width / 2 - camX + shakeX, height / 2 - camY + shakeY);

    this.drawGround(left, top, right, bottom);
    if (frame.phase !== "waiting") {
      this.drawZone(frame.zone, left, top, right, bottom);
    }
    this.drawTracers();
    this.drawPlayers(frame, camX, camY);
    this.drawFloatTexts();

    ctx.restore();

    this.drawScreenEffects(frame, width, height);
    if (frame.pointer.inside && frame.selfAlive && frame.phase !== "ended") {
      this.drawCrosshair(frame.pointer, width, height, frame.firing);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 尺寸与特效                                                          */
  /* ------------------------------------------------------------------ */

  private syncSize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;

    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.vignette = null;
      this.dangerGlow = null;
    }
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
  }

  private updateEffects(dt: number): void {
    for (const tracer of this.tracers) tracer.life -= dt;
    this.tracers = this.tracers.filter((tracer) => tracer.life > 0);

    for (const text of this.texts) {
      text.life -= dt;
      text.y -= dt * 26;
    }
    this.texts = this.texts.filter((text) => text.life > 0);

    const now = performance.now();
    for (const [id, until] of this.hitFlashes) {
      if (until < now) this.hitFlashes.delete(id);
    }

    this.screenFlash = Math.max(0, this.screenFlash - dt);
    this.shake = Math.max(0, this.shake - dt * 42);
  }

  /* ------------------------------------------------------------------ */
  /* 世界层                                                              */
  /* ------------------------------------------------------------------ */

  private drawGround(left: number, top: number, right: number, bottom: number): void {
    const { ctx } = this;

    ctx.fillStyle = "#0a2029";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // 网格（只画视野内的线）
    const startX = Math.floor(Math.max(0, left) / GRID_STEP) * GRID_STEP;
    const endX = Math.min(WORLD_WIDTH, right);
    const startY = Math.floor(Math.max(0, top) / GRID_STEP) * GRID_STEP;
    const endY = Math.min(WORLD_HEIGHT, bottom);

    ctx.strokeStyle = "rgba(56, 189, 248, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += GRID_STEP) {
      ctx.moveTo(x, Math.max(0, top));
      ctx.lineTo(x, Math.min(WORLD_HEIGHT, bottom));
    }
    for (let y = startY; y <= endY; y += GRID_STEP) {
      ctx.moveTo(Math.max(0, left), y);
      ctx.lineTo(Math.min(WORLD_WIDTH, right), y);
    }
    ctx.stroke();

    // 边界
    ctx.strokeStyle = "rgba(94, 234, 212, 0.22)";
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.strokeStyle = "rgba(94, 234, 212, 0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, WORLD_WIDTH - 4, WORLD_HEIGHT - 4);
  }

  private drawZone(
    zone: NetZone,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    const { ctx } = this;
    const radius = Math.max(0.5, zone.radius);

    // 圈外危险色（evenodd：矩形挖掉圆）
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.arc(zone.cx, zone.cy, radius, 0, TAU);
    ctx.fillStyle = "rgba(190, 24, 93, 0.22)";
    ctx.fill("evenodd");
    ctx.restore();

    ctx.beginPath();
    ctx.arc(zone.cx, zone.cy, radius, 0, TAU);
    ctx.strokeStyle = "rgba(244, 114, 182, 0.16)";
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.strokeStyle = "rgba(251, 113, 133, 0.9)";
    ctx.lineWidth = 3.5;
    ctx.stroke();

    if (zone.shrinking || zone.targetRadius < radius - 2) {
      ctx.beginPath();
      ctx.arc(zone.cx, zone.cy, Math.max(0.5, zone.targetRadius), 0, TAU);
      ctx.strokeStyle = "rgba(226, 232, 240, 0.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([16, 14]);
      ctx.lineDashOffset = -performance.now() * 0.02;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }

  private drawTracers(): void {
    const { ctx } = this;
    if (this.tracers.length === 0) return;

    ctx.lineCap = "round";
    for (const tracer of this.tracers) {
      const alpha = Math.max(0, tracer.life / tracer.maxLife);
      const cos = Math.cos(tracer.aim);
      const sin = Math.sin(tracer.aim);
      const startX = tracer.x + cos * 18;
      const startY = tracer.y + sin * 18;
      const endX = tracer.x + cos * 620;
      const endY = tracer.y + sin * 620;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = tracer.self ? "rgba(253, 230, 138, 0.35)" : "rgba(251, 146, 60, 0.3)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      ctx.strokeStyle = tracer.self ? "rgba(254, 240, 138, 0.95)" : "rgba(253, 186, 116, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayers(frame: RenderFrame, camX: number, camY: number): void {
    for (const player of frame.players) {
      if (!player.alive) {
        this.drawCorpse(player);
        continue;
      }
      this.drawPlayer(player, player.id === frame.selfId, camX, camY);
    }
  }

  private drawPlayer(player: NetPlayer, self: boolean, camX: number, camY: number): void {
    const { ctx } = this;
    const r = PLAYER_RADIUS;
    const cos = Math.cos(player.aimAngle);
    const sin = Math.sin(player.aimAngle);
    const distance = Math.hypot(player.x - camX, player.y - camY);

    // 影子
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(player.x + 4, player.y + 6, r * 0.95, r * 0.75, 0, 0, TAU);
    ctx.fill();

    // 自己：呼吸光环
    if (self) {
      const pulse = 0.4 + Math.sin(performance.now() * 0.004) * 0.15;
      ctx.strokeStyle = `rgba(45, 212, 191, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, r + 7, 0, TAU);
      ctx.stroke();
    }

    // 枪
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0b1720";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(player.x + cos * 6, player.y + sin * 6);
    ctx.lineTo(player.x + cos * 25, player.y + sin * 25);
    ctx.stroke();
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x + cos * 10, player.y + sin * 10);
    ctx.lineTo(player.x + cos * 26, player.y + sin * 26);
    ctx.stroke();

    // 身体
    ctx.fillStyle = self ? "#2dd4bf" : colorFor(player.id);
    ctx.beginPath();
    ctx.arc(player.x, player.y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = self ? "#ecfeff" : "rgba(8, 20, 28, 0.85)";
    ctx.lineWidth = self ? 3 : 2;
    ctx.stroke();

    // 高光
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.arc(player.x - r * 0.3, player.y - r * 0.35, r * 0.38, 0, TAU);
    ctx.fill();

    // 受击闪白
    const flashUntil = this.hitFlashes.get(player.id);
    if (flashUntil && flashUntil > performance.now()) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(player.x, player.y, r + 1, 0, TAU);
      ctx.stroke();
    }

    // 准星辅助线（仅自己）
    if (self) {
      ctx.strokeStyle = "rgba(94, 234, 212, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(player.x + cos * 32, player.y + sin * 32);
      ctx.lineTo(player.x + cos * 110, player.y + sin * 110);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 名字
    if (self || distance < 720) {
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = self ? "#ccfbf1" : "rgba(226, 232, 240, 0.82)";
      ctx.fillText(player.name, player.x, player.y - r - 22);
    }

    // 血条
    if (self || player.hp < 100 || distance < 720) {
      const w = 40;
      const h = 4;
      const bx = player.x - w / 2;
      const by = player.y - r - 14;
      ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
      ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      ctx.fillStyle =
        player.hp > 55 ? "#4ade80" : player.hp > 25 ? "#facc15" : "#f87171";
      ctx.fillRect(bx, by, (w * clamp(player.hp, 0, 100)) / 100, h);
    }
  }

  private drawCorpse(player: NetPlayer): void {
    const { ctx } = this;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_RADIUS * 0.9, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(248, 113, 113, 0.8)";
    ctx.lineWidth = 2;
    const s = PLAYER_RADIUS * 0.55;
    ctx.beginPath();
    ctx.moveTo(player.x - s, player.y - s);
    ctx.lineTo(player.x + s, player.y + s);
    ctx.moveTo(player.x + s, player.y - s);
    ctx.lineTo(player.x - s, player.y + s);
    ctx.stroke();

    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(226, 232, 240, 0.65)";
    ctx.fillText(player.name, player.x, player.y - PLAYER_RADIUS - 10);
    ctx.globalAlpha = 1;
  }

  private drawFloatTexts(): void {
    if (this.texts.length === 0) return;
    const { ctx } = this;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 12px ${FONT}`;
    for (const text of this.texts) {
      const alpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, text.x, text.y);
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ */
  /* 屏幕层                                                              */
  /* ------------------------------------------------------------------ */

  private drawScreenEffects(frame: RenderFrame, width: number, height: number): void {
    const { ctx } = this;
    const key = `${width}x${height}`;

    if (!this.vignette || this.vignetteKey !== key) {
      const radius = Math.hypot(width, height) * 0.62;
      const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.34,
        width / 2,
        height / 2,
        radius,
      );
      vignette.addColorStop(0, "rgba(3, 10, 16, 0)");
      vignette.addColorStop(0.72, "rgba(3, 10, 16, 0.14)");
      vignette.addColorStop(1, "rgba(3, 10, 16, 0.6)");
      this.vignette = vignette;
      this.vignetteKey = key;

      const danger = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.3,
        width / 2,
        height / 2,
        radius,
      );
      danger.addColorStop(0, "rgba(190, 18, 60, 0)");
      danger.addColorStop(0.7, "rgba(190, 18, 60, 0.1)");
      danger.addColorStop(1, "rgba(190, 18, 60, 0.62)");
      this.dangerGlow = danger;
      this.dangerKey = key;
    }

    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, width, height);
    }

    if (frame.outside && this.dangerGlow && this.dangerKey === key) {
      const pulse = 0.55 + Math.sin(performance.now() * 0.005) * 0.15;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = this.dangerGlow;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    if (this.screenFlash > 0) {
      ctx.fillStyle = `rgba(248, 113, 113, ${Math.min(0.32, this.screenFlash)})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  private drawCrosshair(
    pointer: { x: number; y: number },
    width: number,
    height: number,
    firing: boolean,
  ): void {
    const { ctx } = this;
    const gap = firing ? 11 : 8;
    const len = 6;
    const x = clamp(pointer.x, 0, width);
    const y = clamp(pointer.y, 0, height);

    ctx.strokeStyle = "rgba(236, 254, 255, 0.92)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y);
    ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);
    ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len);
    ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap);
    ctx.lineTo(x, y + gap + len);
    ctx.stroke();

    ctx.strokeStyle = "rgba(45, 212, 191, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, gap + 5, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = "rgba(236, 254, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, TAU);
    ctx.fill();
  }
}

/** 供页面兜底使用的初始毒圈（未收到 state 前） */
export const FALLBACK_ZONE: NetZone = {
  cx: WORLD_WIDTH / 2,
  cy: WORLD_HEIGHT / 2,
  radius: ZONE_START_RADIUS,
  targetRadius: ZONE_START_RADIUS,
  shrinking: false,
  dps: 0,
  shrinkIn: SHRINK_START_SECONDS,
  progress: 0,
};
