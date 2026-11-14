/** 答对提示音：本地 Web Audio 短音，无外部资源。 */
export function playSuccessChime(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const beep = (freq: number, start: number, dur: number, gain = 0.08) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    };

    // 两声上扬短音
    beep(880, now, 0.12);
    beep(1320, now + 0.14, 0.16, 0.07);

    void ctx.resume().catch(() => undefined);
    setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 600);
  } catch {
    // 忽略音效失败，不影响听写
  }
}
