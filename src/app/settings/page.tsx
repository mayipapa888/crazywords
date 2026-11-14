"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [goal, setGoal] = useState(20);
  const [cloze, setCloze] = useState(true);
  const [autoSubmit, setAutoSubmit] = useState(15);
  const [autoStart, setAutoStart] = useState(10);
  const [autoNext, setAutoNext] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
            <span className="font-medium block">启用例句挖空</span>
            <span className="text-sm text-[var(--muted)]">
              关闭后听写仅走释义拼写。默认开启。
            </span>
          </span>
        </label>

        <div className="border-t border-[var(--line)] pt-4 space-y-4">
          <p className="font-medium">实时听写计时（秒）</p>
          <div>
            <label className="label">自动开始录音（进入题目后）</label>
            <input
              type="number"
              min={1}
              max={300}
              className="field"
              value={autoStart}
              onChange={(e) => setAutoStart(Number(e.target.value) || 10)}
            />
            <p className="text-xs text-[var(--muted)] mt-1">默认 10</p>
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
        <p className="font-medium text-[var(--ink)]">语音服务</p>
        <p>
          <code className="bg-[var(--chip)] px-1 rounded">SPEECH_PROVIDER=aliyun</code>{" "}
          时听写使用<strong>实时语音识别</strong>（WebSocket）；项目须开通该能力。开发可用{" "}
          <code className="bg-[var(--chip)] px-1 rounded">mock</code> 模拟边说边出字。
        </p>
      </div>
    </div>
  );
}
