/**
 * 吃鸡训练场 · WebAudio 合成音效
 *
 * 不引入任何音频资源，全部由振荡器 + 噪声缓冲实时合成。
 * AudioContext 必须在用户手势（点击开始）后创建 / resume。
 */

import type { BattleSoundName } from "./engine";

type AudioContextCtor = new () => AudioContext;

export class BattleSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: AudioContextCtor })
        .webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.2;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.noise = this.createNoise(ctx);
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.2;
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }

  play(name: BattleSoundName): void {
    if (this.muted) return;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== "running") return;

    switch (name) {
      case "shot":
        this.noiseBurst(ctx, master, 0.075, 1400, 0.5);
        this.tone(ctx, master, 150, 70, 0.09, 0.16, "square");
        break;
      case "hit":
        this.tone(ctx, master, 900, 520, 0.06, 0.12, "square");
        break;
      case "hurt":
        this.tone(ctx, master, 200, 80, 0.2, 0.2, "sawtooth");
        break;
      case "reload":
        this.tone(ctx, master, 620, 420, 0.05, 0.1, "square");
        this.tone(ctx, master, 320, 260, 0.05, 0.08, "square", 0.12);
        break;
      case "reload-done":
        this.tone(ctx, master, 700, 700, 0.06, 0.09, "triangle");
        this.tone(ctx, master, 1050, 1050, 0.08, 0.1, "triangle", 0.08);
        break;
      case "empty":
        this.tone(ctx, master, 220, 150, 0.05, 0.09, "square");
        break;
      case "kill":
        this.tone(ctx, master, 523, 523, 0.1, 0.14, "triangle");
        this.tone(ctx, master, 784, 784, 0.16, 0.14, "triangle", 0.1);
        break;
      case "pickup":
        this.tone(ctx, master, 880, 1320, 0.1, 0.1, "sine");
        break;
      default:
        break;
    }
  }

  private createNoise(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.35);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private noiseBurst(
    ctx: AudioContext,
    master: GainNode,
    duration: number,
    frequency: number,
    volume: number,
  ): void {
    if (!this.noise) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + duration);
  }

  private tone(
    ctx: AudioContext,
    master: GainNode,
    from: number,
    to: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    delay = 0,
  ): void {
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }
}
