/**
 * 吃鸡训练场 · Canvas 渲染器
 *
 * 只负责「把引擎状态画出来」，不修改引擎。
 * 地面纹理使用离屏 Canvas + createPattern，避免每帧画上千条网格线。
 */

import {
  FIGHTER_RADIUS,
  WORLD_SIZE,
  ZONE_CENTER,
  type BattleEngine,
  type Fighter,
  type Obstacle,
} from "./engine";

export interface Camera {
  x: number;
  y: number;
}

export interface PointerView {
  x: number;
  y: number;
  inside: boolean;
}

const TAU = Math.PI * 2;
const PLAYER_COLOR = "#2dd4bf";
const FONT = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';

export class BattleRenderer {
  private ground: CanvasPattern | null = null;
  private vignette: CanvasGradient | null = null;
  private dangerVignette: CanvasGradient | null = null;
  private gradientW = 0;
  private gradientH = 0;

  /** 开始界面/结束界面的静态背景 */
  drawIdle(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#071722";
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * 0.5,
      height * 0.45,
      0,
      width * 0.5,
      height * 0.45,
      Math.max(width, height) * 0.65,
    );
    glow.addColorStop(0, "rgba(14, 116, 144, 0.35)");
    glow.addColorStop(0.55, "rgba(8, 47, 73, 0.25)");
    glow.addColorStop(1, "rgba(3, 12, 18, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const step = 64;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (width % step) / 2; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = (height % step) / 2; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(94, 234, 212, 0.22)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(
        width * 0.5,
        height * 0.45,
        90 + i * 76,
        0,
        TAU,
      );
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(148, 233, 255, 0.25)";
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("21 人 · 2400 × 2400 · 5 分钟", width * 0.5, height * 0.45 + 210);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    engine: BattleEngine,
    camera: Camera,
    viewW: number,
    viewH: number,
    dpr: number,
    pointer: PointerView,
    firing: boolean,
  ): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    const shake = engine.shake;
    const shakeX = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const shakeY = shake > 0 ? (Math.random() - 0.5) * shake : 0;

    const left = camera.x - 80;
    const top = camera.y - 80;
    const right = camera.x + viewW + 80;
    const bottom = camera.y + viewH + 80;

    ctx.save();
    ctx.translate(-camera.x + shakeX, -camera.y + shakeY);

    this.drawGround(ctx, left, top, right, bottom);
    this.drawZone(ctx, engine, left, top, right, bottom);
    this.drawObstacles(ctx, engine.obstacles, left, top, right, bottom);
    this.drawPickups(ctx, engine);
    this.drawCorpses(ctx, engine);
    this.drawParticles(ctx, engine);
    this.drawBullets(ctx, engine);
    this.drawFighters(ctx, engine, left, top, right, bottom);

    ctx.restore();

    this.drawScreenEffects(ctx, engine, viewW, viewH);
    if (pointer.inside && engine.player.alive) {
      this.drawCrosshair(ctx, pointer, firing);
    }
  }

  drawMinimap(
    ctx: CanvasRenderingContext2D,
    engine: BattleEngine,
    size: number,
    pixelRatio: number,
  ): void {
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#081820";
    ctx.fillRect(0, 0, size, size);

    const scale = size / WORLD_SIZE;

    // 网格
    ctx.strokeStyle = "rgba(56, 189, 248, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 6; i += 1) {
      const p = (size * i) / 6;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();

    // 障碍
    for (const o of engine.obstacles) {
      ctx.fillStyle = o.kind === "tree" ? "rgba(34, 197, 94, 0.45)" : "rgba(217, 119, 6, 0.5)";
      ctx.beginPath();
      ctx.arc(o.x * scale, o.y * scale, Math.max(1, o.r * scale * 0.8), 0, TAU);
      ctx.fill();
    }

    // 毒圈外阴影
    const zone = engine.zone;
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(ZONE_CENTER * scale, ZONE_CENTER * scale, zone.radius * scale, 0, TAU);
    ctx.fillStyle = "rgba(190, 24, 93, 0.38)";
    ctx.fill("evenodd");

    // 当前 / 下一个圈
    ctx.strokeStyle = "rgba(244, 114, 182, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ZONE_CENTER * scale, ZONE_CENTER * scale, zone.radius * scale, 0, TAU);
    ctx.stroke();
    if (zone.targetRadius < zone.radius - 2) {
      ctx.strokeStyle = "rgba(226, 232, 240, 0.4)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(
        ZONE_CENTER * scale,
        ZONE_CENTER * scale,
        zone.targetRadius * scale,
        0,
        TAU,
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 弹药补给
    ctx.fillStyle = "rgba(250, 204, 21, 0.9)";
    for (const pickup of engine.pickups) {
      if (!pickup.active) continue;
      ctx.fillRect(pickup.x * scale - 1.5, pickup.y * scale - 1.5, 3, 3);
    }

    // 附近敌人
    const player = engine.player;
    for (const f of engine.fighters) {
      if (!f.alive || f.isPlayer) continue;
      const dx = f.x - player.x;
      const dy = f.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1100) continue;
      ctx.globalAlpha = Math.max(0.25, 1 - dist / 1200);
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.arc(f.x * scale, f.y * scale, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 玩家
    const px = player.x * scale;
    const py = player.y * scale;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(player.angle);
    ctx.fillStyle = PLAYER_COLOR;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  /* ------------------------------------------------------------------ */
  /* 世界层                                                               */
  /* ------------------------------------------------------------------ */

  private drawGround(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    const pattern = this.ensureGround(ctx);
    if (pattern) {
      ctx.fillStyle = pattern;
    } else {
      ctx.fillStyle = "#0c2029";
    }
    ctx.fillRect(left, top, right - left, bottom - top);

    // 地图边界
    ctx.strokeStyle = "rgba(94, 234, 212, 0.22)";
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    ctx.strokeStyle = "rgba(94, 234, 212, 0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, WORLD_SIZE - 4, WORLD_SIZE - 4);
  }

  private ensureGround(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.ground) return this.ground;
    const tile = document.createElement("canvas");
    const size = 200;
    tile.width = size;
    tile.height = size;
    const tileCtx = tile.getContext("2d");
    if (!tileCtx) return null;
    tileCtx.fillStyle = "#0c2029";
    tileCtx.fillRect(0, 0, size, size);

    // 细网格
    tileCtx.strokeStyle = "rgba(56, 189, 248, 0.065)";
    tileCtx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const p = (i * size) / 4;
      tileCtx.beginPath();
      tileCtx.moveTo(p, 0);
      tileCtx.lineTo(p, size);
      tileCtx.moveTo(0, p);
      tileCtx.lineTo(size, p);
      tileCtx.stroke();
    }
    // 大格线
    tileCtx.strokeStyle = "rgba(56, 189, 248, 0.11)";
    tileCtx.lineWidth = 1.5;
    tileCtx.strokeRect(0, 0, size, size);

    // 固定种子的地面碎屑，平铺也不突兀
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 90; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 0.6 + rand() * 1.6;
      tileCtx.fillStyle =
        rand() > 0.5 ? "rgba(45, 212, 191, 0.06)" : "rgba(148, 163, 184, 0.07)";
      tileCtx.beginPath();
      tileCtx.arc(x, y, r, 0, TAU);
      tileCtx.fill();
    }
    for (let i = 0; i < 12; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      tileCtx.strokeStyle = "rgba(34, 197, 94, 0.08)";
      tileCtx.lineWidth = 1;
      tileCtx.beginPath();
      tileCtx.moveTo(x, y);
      tileCtx.lineTo(x + 2, y - 5 - rand() * 4);
      tileCtx.stroke();
    }

    this.ground = ctx.createPattern(tile, "repeat");
    return this.ground;
  }

  private drawZone(
    ctx: CanvasRenderingContext2D,
    engine: BattleEngine,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    const zone = engine.zone;

    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.arc(ZONE_CENTER, ZONE_CENTER, zone.radius, 0, TAU);
    ctx.fillStyle = "rgba(190, 24, 93, 0.2)";
    ctx.fill("evenodd");

    // 圈边发光（双描边模拟）
    ctx.beginPath();
    ctx.arc(ZONE_CENTER, ZONE_CENTER, zone.radius, 0, TAU);
    ctx.strokeStyle = "rgba(244, 114, 182, 0.16)";
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.strokeStyle = "rgba(251, 113, 133, 0.9)";
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // 下一个圈：虚线随游戏时间流动
    if (zone.targetRadius < zone.radius - 2) {
      ctx.beginPath();
      ctx.arc(ZONE_CENTER, ZONE_CENTER, zone.targetRadius, 0, TAU);
      ctx.strokeStyle = "rgba(226, 232, 240, 0.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([16, 14]);
      ctx.lineDashOffset = -engine.elapsed * 26;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }

  private drawObstacles(
    ctx: CanvasRenderingContext2D,
    obstacles: Obstacle[],
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    for (const o of obstacles) {
      const pad = o.r + 30;
      if (o.x + pad < left || o.x - pad > right || o.y + pad < top || o.y - pad > bottom) {
        continue;
      }
      if (o.kind === "crate") {
        this.drawCrate(ctx, o);
      } else {
        this.drawTree(ctx, o);
      }
    }
  }

  private drawCrate(ctx: CanvasRenderingContext2D, o: Obstacle): void {
    const x = o.x - o.r;
    const y = o.y - o.r;
    const size = o.r * 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(x + 4, y + 6, size, size);
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = "#4b2a12";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, size, size);
    ctx.strokeStyle = "rgba(40, 20, 8, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + size * 0.33, y);
    ctx.lineTo(x + size * 0.33, y + size);
    ctx.moveTo(x + size * 0.66, y);
    ctx.lineTo(x + size * 0.66, y + size);
    ctx.moveTo(x, y + size * 0.5);
    ctx.lineTo(x + size, y + size * 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(253, 230, 138, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 2);
    ctx.lineTo(x + size - 2, y + 2);
    ctx.stroke();
  }

  private drawTree(ctx: CanvasRenderingContext2D, o: Obstacle): void {
    const r = o.r;
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.beginPath();
    ctx.ellipse(o.x + 7, o.y + 9, r * 0.95, r * 0.8, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#14532d";
    ctx.beginPath();
    ctx.arc(o.x, o.y, r, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#166534";
    ctx.beginPath();
    ctx.arc(o.x - r * 0.2, o.y - r * 0.2, r * 0.72, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(74, 222, 128, 0.22)";
    ctx.beginPath();
    ctx.arc(o.x - r * 0.32, o.y - r * 0.34, r * 0.38, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(20, 83, 45, 0.9)";
    ctx.beginPath();
    ctx.arc(o.x + r * 0.22, o.y + r * 0.2, r * 0.45, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(6, 78, 59, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(o.x, o.y, r, 0, TAU);
    ctx.stroke();
  }

  private drawPickups(ctx: CanvasRenderingContext2D, engine: BattleEngine): void {
    for (const pickup of engine.pickups) {
      if (!pickup.active) continue;
      const blink = pickup.life < 5 && Math.floor(pickup.life * 4) % 2 === 0;
      if (blink) continue;
      const bob = Math.sin(engine.elapsed * 3 + pickup.x * 0.05) * 2;
      const x = pickup.x;
      const y = pickup.y + bob;

      ctx.fillStyle = "rgba(250, 204, 21, 0.16)";
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "#3f3f24";
      ctx.fillRect(x - 10, y - 7, 20, 14);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 10, y - 7, 20, 14);
      ctx.fillStyle = "#facc15";
      ctx.fillRect(x - 10, y - 1.5, 20, 3);
      ctx.fillStyle = "#1c1c10";
      ctx.fillRect(x - 6, y + 3, 4, 2);
      ctx.fillRect(x - 1, y + 3, 4, 2);

      ctx.font = `700 9px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(253, 224, 71, 0.9)";
      ctx.fillText("AMMO", x, y - 12);
    }
  }

  private drawCorpses(ctx: CanvasRenderingContext2D, engine: BattleEngine): void {    for (const f of engine.fighters) {
      if (f.alive) continue;
      const age = engine.elapsed - f.deadAt;
      if (age > 9) continue;
      const alpha = Math.max(0, 1 - age / 9) * 0.65;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.beginPath();
      ctx.arc(f.x, f.y, FIGHTER_RADIUS * 0.9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(248, 113, 113, 0.8)";
      ctx.lineWidth = 2;
      const s = FIGHTER_RADIUS * 0.55;
      ctx.beginPath();
      ctx.moveTo(f.x - s, f.y - s);
      ctx.lineTo(f.x + s, f.y + s);
      ctx.moveTo(f.x + s, f.y - s);
      ctx.lineTo(f.x - s, f.y + s);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, engine: BattleEngine): void {
    for (const p of engine.particles) {
      if (!p.active) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawBullets(ctx: CanvasRenderingContext2D, engine: BattleEngine): void {
    ctx.lineCap = "round";
    for (const b of engine.bullets) {
      if (!b.active) continue;
      const color = b.fromPlayer ? "253, 230, 138" : "251, 146, 60";
      ctx.strokeStyle = `rgba(${color}, 0.22)`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${color}, 0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  private drawFighters(
    ctx: CanvasRenderingContext2D,
    engine: BattleEngine,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    const player = engine.player;

    for (const f of engine.fighters) {
      if (!f.alive) continue;
      const margin = 90;
      if (f.x + margin < left || f.x - margin > right || f.y + margin < top || f.y - margin > bottom) {
        continue;
      }
      this.drawFighter(ctx, f, player, engine.elapsed);
    }
  }

  private drawFighter(
    ctx: CanvasRenderingContext2D,
    f: Fighter,
    player: Fighter,
    elapsed: number,
  ): void {
    const r = FIGHTER_RADIUS;
    const cos = Math.cos(f.angle);
    const sin = Math.sin(f.angle);
    const distToPlayer = Math.hypot(f.x - player.x, f.y - player.y);

    // 影子
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(f.x + 4, f.y + 6, r * 0.95, r * 0.75, 0, 0, TAU);
    ctx.fill();

    // 玩家光环
    if (f.isPlayer) {
      const pulse = 0.45 + Math.sin(elapsed * 4) * 0.15;
      ctx.strokeStyle = `rgba(45, 212, 191, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r + 7, 0, TAU);
      ctx.stroke();
    }

    // 枪
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0b1720";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(f.x + cos * 6, f.y + sin * 6);
    ctx.lineTo(f.x + cos * 25, f.y + sin * 25);
    ctx.stroke();
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x + cos * 10, f.y + sin * 10);
    ctx.lineTo(f.x + cos * 26, f.y + sin * 26);
    ctx.stroke();

    // 身体
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = f.isPlayer ? "#ecfeff" : "rgba(8, 20, 28, 0.85)";
    ctx.lineWidth = f.isPlayer ? 3 : 2;
    ctx.stroke();

    // 高光
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.arc(f.x - r * 0.3, f.y - r * 0.35, r * 0.38, 0, TAU);
    ctx.fill();

    // 护甲环
    if (f.armor > 0) {
      const ratio = Math.min(1, f.armor / 100);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
      ctx.stroke();
    }

    // 枪口火光
    if (f.muzzle > 0) {
      const mx = f.x + cos * 28;
      const my = f.y + sin * 28;
      ctx.fillStyle = "rgba(254, 240, 138, 0.95)";
      ctx.beginPath();
      ctx.arc(mx, my, 5.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(251, 146, 60, 0.7)";
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, TAU);
      ctx.fill();
    }

    // 命中闪白
    if (f.hitFlash > 0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r + 1, 0, TAU);
      ctx.stroke();
    }

    // 玩家瞄准辅助线
    if (f.isPlayer) {
      ctx.strokeStyle = "rgba(94, 234, 212, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(f.x + cos * 32, f.y + sin * 32);
      ctx.lineTo(f.x + cos * 110, f.y + sin * 110);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 名字
    if (f.isPlayer || distToPlayer < 620) {
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = f.isPlayer ? "#ccfbf1" : "rgba(226, 232, 240, 0.8)";
      ctx.fillText(f.name, f.x, f.y - r - 22);
    }

    // 血条
    if (f.isPlayer || f.hp < 100) {
      const w = 38;
      const h = 4;
      const bx = f.x - w / 2;
      const by = f.y - r - 14;
      ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
      ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      ctx.fillStyle = f.hp > 55 ? "#4ade80" : f.hp > 25 ? "#facc15" : "#f87171";
      ctx.fillRect(bx, by, (w * Math.max(0, f.hp)) / 100, h);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 屏幕层                                                               */
  /* ------------------------------------------------------------------ */

  private drawScreenEffects(
    ctx: CanvasRenderingContext2D,
    engine: BattleEngine,
    width: number,
    height: number,
  ): void {
    if (!this.vignette || this.gradientW !== width || this.gradientH !== height) {
      const radius = Math.hypot(width, height) * 0.62;
      const dark = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.32,
        width / 2,
        height / 2,
        radius,
      );
      dark.addColorStop(0, "rgba(3, 10, 16, 0)");
      dark.addColorStop(0.72, "rgba(3, 10, 16, 0.16)");
      dark.addColorStop(1, "rgba(3, 10, 16, 0.62)");
      this.vignette = dark;

      const danger = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.28,
        width / 2,
        height / 2,
        radius,
      );
      danger.addColorStop(0, "rgba(190, 18, 60, 0)");
      danger.addColorStop(0.68, "rgba(190, 18, 60, 0.12)");
      danger.addColorStop(1, "rgba(190, 18, 60, 0.62)");
      this.dangerVignette = danger;
      this.gradientW = width;
      this.gradientH = height;
    }

    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, width, height);
    }

    const player = engine.player;
    if (player.alive && player.hp <= 40 && this.dangerVignette) {
      const intensity = 0.45 + (1 - player.hp / 40) * 0.55;
      ctx.globalAlpha = Math.min(1, intensity);
      ctx.fillStyle = this.dangerVignette;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    if (player.hitFlash > 0) {
      ctx.fillStyle = "rgba(248, 113, 113, 0.16)";
      ctx.fillRect(0, 0, width, height);
    }

    if (engine.over) {
      ctx.fillStyle = "rgba(3, 12, 18, 0.35)";
      ctx.fillRect(0, 0, width, height);
    }
  }

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    pointer: PointerView,
    firing: boolean,
  ): void {
    const gap = firing ? 11 : 8;
    const len = 6;
    const x = pointer.x;
    const y = pointer.y;
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
