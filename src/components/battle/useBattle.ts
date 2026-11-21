"use client";

/**
 * 吃鸡训练场 · React 挂载层
 *
 * 负责：canvas 尺寸、rAF 固定步长循环、输入监听、相机、HUD 节流刷新。
 * 游戏规则全部在 engine.ts，绘制全部在 renderer.ts。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  BattleEngine,
  MATCH_SECONDS,
  WORLD_SIZE,
  type BattleHud,
  type BattleResult,
  type FeedTone,
} from "./engine";
import { BattleRenderer, type Camera, type PointerView } from "./renderer";
import { BattleSfx } from "./sfx";

export type BattlePhase = "ready" | "playing" | "over";

export interface FeedItem {
  id: number;
  text: string;
  tone: FeedTone;
  at: number;
}

export interface BattleController {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  minimapRef: RefObject<HTMLCanvasElement | null>;
  phase: BattlePhase;
  hud: BattleHud;
  feed: FeedItem[];
  result: BattleResult | null;
  muted: boolean;
  start: (armor: number) => void;
  toggleMuted: () => void;
}

const STEP = 1 / 60;
const MAX_FRAME_DT = 0.1;
const MAX_STEPS = 5;
const HUD_INTERVAL = 100;
const MINIMAP_SIZE = 168;
const MINIMAP_RATIO = 2;
const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const INITIAL_HUD: BattleHud = {
  hp: 100,
  maxHp: 100,
  armor: 0,
  maxArmor: 0,
  mag: 30,
  reserve: 120,
  reloading: false,
  reloadProgress: 1,
  alive: 21,
  total: 21,
  kills: 0,
  timeLeft: MATCH_SECONDS,
  elapsed: 0,
  zone: {
    radius: 2000,
    dps: 2,
    phase: 0,
    shrinking: false,
    timeLeft: 15,
    final: false,
  },
  outside: false,
  damageRate: 0,
};

export function useBattle(): BattleController {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);

  const [phase, setPhase] = useState<BattlePhase>("ready");
  const [hud, setHud] = useState<BattleHud>(INITIAL_HUD);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [muted, setMuted] = useState(false);

  const engineRef = useRef<BattleEngine | null>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const sfxRef = useRef<BattleSfx | null>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0 });
  const viewRef = useRef({ w: 800, h: 600 });
  const dprRef = useRef(1);
  const keysRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef<PointerView>({ x: 400, y: 300, inside: false });
  const firingRef = useRef(false);
  const mutedRef = useRef(false);
  const feedIdRef = useRef(0);

  const getRenderer = useCallback((): BattleRenderer => {
    if (!rendererRef.current) rendererRef.current = new BattleRenderer();
    return rendererRef.current;
  }, []);

  const start = useCallback((armor: number) => {
    const engine = new BattleEngine(armor);
    engineRef.current = engine;
    keysRef.current.clear();
    firingRef.current = false;

    const view = viewRef.current;
    cameraRef.current = {
      x: clamp(engine.player.x - view.w / 2, 0, Math.max(0, WORLD_SIZE - view.w)),
      y: clamp(engine.player.y - view.h / 2, 0, Math.max(0, WORLD_SIZE - view.h)),
    };
    mouseRef.current = { x: view.w / 2, y: view.h / 2, inside: false };

    feedIdRef.current = 0;
    setFeed([]);
    setResult(null);
    setHud(engine.getHud());

    if (!sfxRef.current) sfxRef.current = new BattleSfx();
    sfxRef.current.unlock();
    sfxRef.current.setMuted(mutedRef.current);

    setPhase("playing");
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      sfxRef.current?.setMuted(next);
      return next;
    });
  }, []);

  /** 尺寸自适应：ResizeObserver + devicePixelRatio，最多渲染 2x */
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const renderer = getRenderer();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      viewRef.current = { w: width, h: height };
      dprRef.current = dpr;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const engine = engineRef.current;
      if (engine) {
        renderer.draw(
          ctx,
          engine,
          cameraRef.current,
          width,
          height,
          dpr,
          mouseRef.current,
          firingRef.current,
        );
      } else {
        renderer.drawIdle(ctx, width, height, dpr);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [getRenderer]);

  /** 游戏循环与输入监听：phase 变为 playing 时启动，结束时完整清理 */
  useEffect(() => {
    if (phase !== "playing") return;
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const renderer = getRenderer();
    const keys = keysRef.current;

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = event.clientX - rect.left;
      mouseRef.current.y = event.clientY - rect.top;
      mouseRef.current.inside = true;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (MOVE_KEYS.has(event.code)) {
        event.preventDefault();
        keys.add(event.code);
      }
      if (event.code === "KeyR") engine.playerReload();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    const clearInput = () => {
      keys.clear();
      firingRef.current = false;
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      updatePointer(event);
      firingRef.current = true;
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.button === 0) firingRef.current = false;
    };
    const handlePointerLeave = () => {
      mouseRef.current.inside = false;
      firingRef.current = false;
    };
    const handleContextMenu = (event: Event) => {
      event.preventDefault();
    };
    const handleVisibility = () => {
      if (document.hidden) clearInput();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("blur", clearInput);
    canvas.addEventListener("pointermove", updatePointer);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("visibilitychange", handleVisibility);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastHud = 0;
    let lastMinimap = 0;

    const frame = (now: number) => {
      const rawDt = Math.min(MAX_FRAME_DT, Math.max(0, (now - last) / 1000));
      last = now;

      const view = viewRef.current;
      const camera = cameraRef.current;
      const player = engine.player;

      // 相机平滑跟随（clamp 到地图边界）
      const targetX = clamp(player.x - view.w / 2, 0, Math.max(0, WORLD_SIZE - view.w));
      const targetY = clamp(player.y - view.h / 2, 0, Math.max(0, WORLD_SIZE - view.h));
      const follow = 1 - Math.exp(-12 * rawDt);
      camera.x += (targetX - camera.x) * follow;
      camera.y += (targetY - camera.y) * follow;

      const pointer = mouseRef.current;
      const aimX = camera.x + pointer.x;
      const aimY = camera.y + pointer.y;

      // 固定步长：最多补 5 步，避免切后台后一次性追帧
      acc += rawDt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        const moveX =
          (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
          (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
        const moveY =
          (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) -
          (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);

        engine.step(STEP, {
          moveX,
          moveY,
          aimX,
          aimY,
          firing: firingRef.current,
        });
        acc -= STEP;
        steps += 1;
        if (engine.over) break;
      }
      if (acc > STEP * MAX_STEPS) acc = 0;

      // 引擎事件 → 音效 / 击杀提示
      const events = engine.takeEvents();
      if (events.length > 0) {
        const feedItems: FeedItem[] = [];
        for (const event of events) {
          if (event.type === "feed") {
            feedIdRef.current += 1;
            feedItems.push({
              id: feedIdRef.current,
              text: event.text,
              tone: event.tone,
              at: now,
            });
          } else {
            sfxRef.current?.play(event.type);
          }
        }
        if (feedItems.length > 0) {
          setFeed((prev) => [...prev, ...feedItems].slice(-5));
        }
      }

      renderer.draw(
        ctx,
        engine,
        camera,
        view.w,
        view.h,
        dprRef.current,
        pointer,
        firingRef.current,
      );

      const minimap = minimapRef.current;
      if (minimap && now - lastMinimap > 66) {
        const minimapCtx = minimap.getContext("2d");
        if (minimapCtx) {
          renderer.drawMinimap(minimapCtx, engine, MINIMAP_SIZE, MINIMAP_RATIO);
        }
        lastMinimap = now;
      }

      if (now - lastHud > HUD_INTERVAL) {
        setHud(engine.getHud());
        lastHud = now;
      }

      if (engine.over) {
        setHud(engine.getHud());
        if (engine.result) setResult(engine.result);
        setPhase("over");
        return;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      keys.clear();
      firingRef.current = false;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("blur", clearInput);
      canvas.removeEventListener("pointermove", updatePointer);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [phase, getRenderer]);

  /** 击杀提示 5 秒后淡出 */
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => {
      const cutoff = performance.now() - 5000;
      setFeed((prev) =>
        prev.some((item) => item.at < cutoff)
          ? prev.filter((item) => item.at >= cutoff)
          : prev,
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  /** 卸载时释放 AudioContext */
  useEffect(() => {
    return () => {
      sfxRef.current?.dispose();
      sfxRef.current = null;
    };
  }, []);

  return {
    containerRef,
    canvasRef,
    minimapRef,
    phase,
    hud,
    feed,
    result,
    muted,
    start,
    toggleMuted,
  };
}
