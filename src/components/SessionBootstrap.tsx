"use client";

import { useEffect, useState } from "react";

/** 确保会话 cookie；若配置了 APP_ACCESS_PASSWORD 则显示门禁。 */
export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [gated, setGated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await fetch("/api/auth/login").then((r) => r.json());
      if (cancelled) return;
      if (meta.gated) {
        // 尝试已有解锁 cookie 的会话
        const probe = await fetch("/api/me");
        if (probe.ok) {
          setReady(true);
          return;
        }
        setGated(true);
        return;
      }
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!cancelled) setReady(true);
    })().catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        return;
      }
      setGated(false);
      setReady(true);
    } finally {
      setBusy(false);
    }
  }

  if (gated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <form onSubmit={login} className="panel p-6 w-full max-w-sm space-y-4">
          <h1 className="font-display text-2xl">CrazyWords</h1>
          <p className="text-sm text-[var(--muted)]">此实例已开启访问门禁，请输入密码。</p>
          <input
            type="password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="访问密码"
            autoFocus
          />
          {error && (
            <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 rounded-md">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "验证中…" : "进入"}
          </button>
        </form>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-[var(--muted)] text-sm">
        初始化会话…
      </div>
    );
  }

  return <>{children}</>;
}
