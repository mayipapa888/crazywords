/** 听写本地音效（Web Audio，无外部资源） */

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** 答对：更大声的叮咚（两声上扬） */
export function playSuccessChime(): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    tone(ctx, 784, now, 0.14, 0.28);
    tone(ctx, 1046, now + 0.13, 0.18, 0.32);
    tone(ctx, 1318, now + 0.28, 0.22, 0.26);
    void ctx.resume().catch(() => undefined);
    setTimeout(() => void ctx.close().catch(() => undefined), 800);
  } catch {
    // ignore
  }
}

/** 答错：惋惜音（下行短音） */
export function playFailChime(): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    tone(ctx, 392, now, 0.2, 0.22, "triangle");
    tone(ctx, 294, now + 0.18, 0.28, 0.2, "triangle");
    void ctx.resume().catch(() => undefined);
    setTimeout(() => void ctx.close().catch(() => undefined), 700);
  } catch {
    // ignore
  }
}

/** @deprecated 使用 playSuccessChime */
export { playSuccessChime as playSuccess };
