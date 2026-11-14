"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [goal, setGoal] = useState(20);
  const [cloze, setCloze] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((m) => {
        setGoal(m.dailyGoalDefault);
        setCloze(m.clozeEnabled);
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
        body: JSON.stringify({ dailyGoalDefault: goal, clozeEnabled: cloze }),
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
        <p className="text-[var(--muted)] mt-1">每日目标与听写出题模式。</p>
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
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "保存中…" : "保存设置"}
        </button>
        {msg && <p className="text-sm text-[var(--teal)]">{msg}</p>}
      </form>

      <div className="panel p-5 text-sm text-[var(--muted)] space-y-2">
        <p className="font-medium text-[var(--ink)]">语音服务</p>
        <p>
          当前通过 <code className="bg-[var(--chip)] px-1 rounded">SPEECH_PROVIDER</code>{" "}
          选择 mock / aliyun stub。真厂商密钥见 <code className="bg-[var(--chip)] px-1 rounded">.env.example</code>。
        </p>
        <p>账号：MVP 使用本地演示用户，邮箱魔法链接尚未接入。</p>
      </div>
    </div>
  );
}
