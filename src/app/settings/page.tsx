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
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="font-display text-3xl">设置</h1>
        <p className="text-[var(--muted)] mt-1">每日目标、出题模式与听写自动计时。</p>
      </div>

      <form onSubmit={save} className="panel p-6 space-y-5">
        <div>
          <label className="label">每日目标 N</label>
          <input
            type="number"
            min={1}
            max={200}
            className="field"
            value={goal}
            onChange={(e) => setGoal(Number(e.target.value) || 1)}
          />
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={cloze}
            onChange={(e) => setCloze(e.target.checked)}
          />
          <span>
            <span className="font-medium block">启用模式 B：报单词 → 说中文</span>
            <span className="text-sm text-[var(--muted)]">
              关闭后仅模式 A（报中文 → 拼写朗读）。字段仍为{" "}
              <code className="bg-[var(--chip)] px-1 rounded">clozeEnabled</code>
              。默认开启；队列中与模式 A 交替出题。
            </span>
          </span>
        </label>

        <div className="border-t border-[var(--line)] pt-4 space-y-4">
          <p className="font-medium">实时听写计时（秒）</p>
          <div>
            <label className="label">自动开始录音（模式 A：TTS 结束后）</label>
            <input
              type="number"
              min={1}
              max={300}
              className="field"
              value={autoStart}
              onChange={(e) => setAutoStart(Number(e.target.value) || 10)}
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              默认 10。计时从释义播报结束起算；模式 B 播报后直接开录。
            </p>
          </div>
          <div>
            <label className="label">自动提交（开录后）</label>
            <input
              type="number"
              min={1}
              max={300}
              className="field"
              value={autoSubmit}
              onChange={(e) => setAutoSubmit(Number(e.target.value) || 15)}
            />
            <p className="text-xs text-[var(--muted)] mt-1">默认 15</p>
          </div>
          <div>
            <label className="label">自动下一词（反馈后）</label>
            <input
              type="number"
              min={1}
              max={300}
              className="field"
              value={autoNext}
              onChange={(e) => setAutoNext(Number(e.target.value) || 30)}
            />
            <p className="text-xs text-[var(--muted)] mt-1">默认 30</p>
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "保存中…" : "保存设置"}
        </button>
        {msg && <p className="text-sm text-[var(--teal)]">{msg}</p>}
      </form>

      <div className="panel p-5 text-sm text-[var(--muted)] space-y-2">
        <p className="font-medium text-[var(--ink)]">语音服务（服务端环境变量）</p>
        {speech ? (
          <ul className="space-y-1">
            <li>
              提供方：<strong className="text-[var(--ink)]">{speech.provider || "—"}</strong>
              {speech.ready ? " · 就绪" : " · 未就绪"}
            </li>
            <li>ASR 密钥：{speech.asrConfigured ? "已配置" : "缺失"}</li>
            <li>TTS 密钥：{speech.ttsConfigured ? "已配置" : "缺失"}</li>
            {speech.nlsRegion && <li>地域：{speech.nlsRegion}</li>}
            <li>{speech.note || speech.error}</li>
          </ul>
        ) : (
          <p>读取中…</p>
        )}
        <p>
          生产：<code className="bg-[var(--chip)] px-1 rounded">SPEECH_PROVIDER=aliyun</code>{" "}
          + <code className="bg-[var(--chip)] px-1 rounded">ASR_*</code> /{" "}
          <code className="bg-[var(--chip)] px-1 rounded">TTS_*</code>
          ；开通「实时语音识别」与「语音合成」。缺密钥会报错，不会静默 mock。
        </p>
      </div>
    </div>
  );
}
