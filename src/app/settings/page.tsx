"use client";

import { useEffect, useState } from "react";

type SpeechStatus = {
  provider?: string;
  mock?: boolean;
  ready?: boolean;
  asrConfigured?: boolean;
  ttsConfigured?: boolean;
  nlsRegion?: string;
  note?: string;
  error?: string;
};

export default function SettingsPage() {
  const [goal, setGoal] = useState(20);
  const [cloze, setCloze] = useState(true);
  const [autoSubmit, setAutoSubmit] = useState(15);
  const [autoStart, setAutoStart] = useState(10);
  const [autoNext, setAutoNext] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [speech, setSpeech] = useState<SpeechStatus | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((m) => {
        setGoal(m.dailyGoalDefault);
        setCloze(m.clozeEnabled);
        setAutoSubmit(m.autoSubmitSeconds ?? 15);
        setAutoStart(m.autoStartRecordSeconds ?? 10);
        setAutoNext(m.autoNextWordSeconds ?? 30);
      });
    fetch("/api/speech/status")
      .then((r) => r.json())
      .then((s) => setSpeech(s))
      .catch(() => setSpeech({ error: "无法读取语音配置状态" }));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyGoalDefault: goal,
          clozeEnabled: cloze,
          autoSubmitSeconds: autoSubmit,
          autoStartRecordSeconds: autoStart,
          autoNextWordSeconds: autoNext,
        }),
      });
      if (!res.ok) {
        setMsg("保存失败");
        return;
      }
      setMsg("已保存");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0">
        <h1 className="font-display text-xl">设置</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          每日目标、出题模式与听写自动计时。
        </p>
      </div>

      <form
        id="settings-form"
        onSubmit={save}
        className="no-scrollbar panel flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        <div className="grid shrink-0 gap-2 sm:grid-cols-3">
          <div>
            <label className="label">每日目标 N</label>
            <input
              type="number"
              min={1}
              max={200}
              className="field py-1.5"
              value={goal}
              onChange={(e) => setGoal(Number(e.target.value) || 1)}
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={cloze}
              onChange={(e) => setCloze(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">（兼容）队列含模式 B 标记</span>
              <span className="text-xs text-[var(--muted)]">
                听写模式请在「听写」页用按钮点选。此开关仅保留字段{" "}
                <code className="rounded bg-[var(--chip)] px-1">clozeEnabled</code>
                ，不再作为进场切换方式。
              </span>
            </span>
          </label>
        </div>

        <div className="shrink-0 border-t border-[var(--line)] pt-2">
          <p className="mb-1 text-sm font-medium">实时听写计时（秒）</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="label">自动开始录音（模式 A：TTS 结束后）</label>
              <input
                type="number"
                min={1}
                max={300}
                className="field py-1.5"
                value={autoStart}
                onChange={(e) => setAutoStart(Number(e.target.value) || 10)}
              />
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                默认 10。计时从释义播报结束起算；模式 B 播报后直接开录。
              </p>
            </div>
            <div>
              <label className="label">自动提交（开录后）</label>
              <input
                type="number"
                min={1}
                max={300}
                className="field py-1.5"
                value={autoSubmit}
                onChange={(e) => setAutoSubmit(Number(e.target.value) || 15)}
              />
              <p className="mt-0.5 text-xs text-[var(--muted)]">默认 15</p>
            </div>
            <div>
              <label className="label">自动下一词（反馈后）</label>
              <input
                type="number"
                min={1}
                max={300}
                className="field py-1.5"
                value={autoNext}
                onChange={(e) => setAutoNext(Number(e.target.value) || 30)}
              />
              <p className="mt-0.5 text-xs text-[var(--muted)]">默认 30</p>
            </div>
          </div>
        </div>

        <div className="panel mt-auto shrink-0 p-3 text-xs text-[var(--muted)]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-[var(--ink)]">语音服务（服务端环境变量）</span>
            {speech ? (
              <>
                <span>
                  提供方：
                  <strong className="text-[var(--ink)]">{speech.provider || "—"}</strong>
                </span>
                <span className={`badge ${speech.ready ? "badge-ok" : "badge-warn"}`}>
                  {speech.ready ? "就绪" : "未就绪"}
                </span>
                <span>ASR 密钥：{speech.asrConfigured ? "已配置" : "缺失"}</span>
                <span>TTS 密钥：{speech.ttsConfigured ? "已配置" : "缺失"}</span>
                {speech.nlsRegion && <span>地域：{speech.nlsRegion}</span>}
                <span>{speech.note || speech.error}</span>
              </>
            ) : (
              <span>读取中…</span>
            )}
          </div>
          <p className="mt-1 leading-snug">
            生产：<code className="rounded bg-[var(--chip)] px-1">SPEECH_PROVIDER=aliyun</code>{" "}
            + <code className="rounded bg-[var(--chip)] px-1">ASR_*</code> /{" "}
            <code className="rounded bg-[var(--chip)] px-1">TTS_*</code>
            ；开通「实时语音识别」与「语音合成」。缺密钥会报错，不会静默 mock。
          </p>
        </div>
      </form>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="submit"
          form="settings-form"
          className="btn-primary py-1.5"
          disabled={busy}
        >
          {busy ? "保存中…" : "保存设置"}
        </button>
        {msg && <p className="text-sm text-[var(--teal)]">{msg}</p>}
      </div>
    </div>
  );
}
