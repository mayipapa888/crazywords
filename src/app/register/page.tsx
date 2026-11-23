"use client";

import { withBase } from "@/lib/base-path";
import Link from "next/link";
import { useState } from "react";

type RegisterErrorBody = {
  error?: string;
};

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;

/** 前端预校验，规则与后端 /api/auth/register 保持一致。 */
function validate(username: string, password: string, confirm: string): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    if (username.length < 3 || username.length > 24) {
      return "用户名长度需为 3–24 位";
    }
    return "用户名只能包含字母、数字、下划线或短横线";
  }
  if (password.length < 8 || password.length > 64) {
    return "密码长度需为 8–64 位";
  }
  if (password !== confirm) {
    return "两次输入的密码不一致";
  }
  return null;
}

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const trimmed = username.trim();
    const problem = validate(trimmed, password, confirm);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBase("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed, password }),
      });
      const data = (await res.json().catch(() => ({}))) as RegisterErrorBody;
      if (res.status === 409) {
        setError("用户名已被占用");
        return;
      }
      if (!res.ok) {
        setError(data.error || "注册失败，请稍后重试");
        return;
      }
      setDone(true);
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
          <p className="mt-1 text-sm text-[var(--muted)]">注册账号，等待管理员开通</p>
        </div>

        {done ? (
          <div className="panel space-y-4 p-6 text-center">
            <p className="font-display text-xl text-[var(--ok)]">注册成功，等待管理员开通</p>
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              账号 {username.trim()} 已提交，管理员开通后即可使用该用户名和密码登录。
            </p>
            <Link href="/login" className="btn-primary w-full">
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="panel space-y-4 p-6" noValidate>
            <div>
              <label htmlFor="register-username" className="label">
                用户名
              </label>
              <input
                id="register-username"
                name="username"
                type="text"
                className="field"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="3–24 位字母、数字、_ 或 -"
                autoComplete="username"
                autoFocus
                maxLength={24}
              />
            </div>

            <div>
              <label htmlFor="register-password" className="label">
                密码
              </label>
              <input
                id="register-password"
                name="password"
                type="password"
                className="field"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="8–64 位"
                autoComplete="new-password"
                maxLength={64}
              />
            </div>

            <div>
              <label htmlFor="register-confirm" className="label">
                确认密码
              </label>
              <input
                id="register-confirm"
                name="confirm"
                type="password"
                className="field"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="再次输入密码"
                autoComplete="new-password"
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
              {busy ? "注册中…" : "注册"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-[var(--muted)]">
          已有账号？{" "}
          <Link href="/login" className="text-[var(--teal)] hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </div>
  );
}
