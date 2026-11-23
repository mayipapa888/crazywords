"use client";

import { withBase } from "@/lib/base-path";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type LoginErrorBody = {
  error?: string;
  status?: string;
};

/** 后端错误码 → 用户可读提示（401 / 403 pending / 403 disabled）。 */
function loginErrorMessage(status: number, body: LoginErrorBody): string {
  if (status === 401) return "用户名或密码错误";
  if (status === 403) {
    if (body.status === "pending") return "账号待管理员开通，请联系管理员";
    if (body.status === "disabled") return "账号已被停用";
    return body.error || "账号不可用";
  }
  return body.error || "登录失败，请稍后重试";
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const trimmed = username.trim();
    if (!trimmed || !password) {
      setError("请输入用户名和密码");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBase("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed, password }),
      });
      const data = (await res.json().catch(() => ({}))) as LoginErrorBody;
      if (!res.ok) {
        setError(loginErrorMessage(res.status, data));
        return;
      }
      // basePath 由 Next 自动补全，这里只写逻辑路径
      router.replace("/");
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-scrollbar flex h-full min-h-screen items-center justify-center overflow-y-auto px-4 py-6">
      <div className="anim-fade-up w-full max-w-sm">
        <div className="mb-4 text-center">
          <p className="font-display text-3xl tracking-tight">CrazyWords</p>
          <p className="mt-1 text-sm text-[var(--muted)]">登录后继续背单词</p>
        </div>

        <form onSubmit={submit} className="panel space-y-4 p-6" noValidate>
          <div>
            <label htmlFor="login-username" className="label">
              用户名
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              className="field"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
              maxLength={24}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="label">
              密码
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              className="field"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              maxLength={64}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
            >
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--muted)]">
          还没有账号？{" "}
          <Link href="/register" className="text-[var(--teal)] hover:underline">
            去注册
          </Link>
        </p>
      </div>
    </div>
  );
}
