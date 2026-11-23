"use client";

import { useSession } from "@/components/SessionBootstrap";
import { withBase } from "@/lib/base-path";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/lookup", label: "查词" },
  { href: "/dictation", label: "听写" },
  { href: "/listening", label: "磨耳朵" },
  { href: "/wrong-book", label: "错词本" },
  { href: "/wordbook", label: "单词本" },
  { href: "/notes", label: "知识点" },
  { href: "/words", label: "词库维护" },
  { href: "/calendar", label: "打卡" },
  { href: "/pet", label: "宠物" },
  { href: "/settings", label: "设置" },
];

/** 登录 / 注册页不显示导航，让表单独占单屏。 */
function isAuthPage(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  // 同时兼容 usePathname() 是否带 basePath 的情况
  return (
    path === "/login" ||
    path === "/register" ||
    path.endsWith("/login") ||
    path.endsWith("/register")
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { user } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);

  if (isAuthPage(pathname)) {
    return <>{children}</>;
  }

  const isAdmin = user?.role === "admin";

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch(withBase("/api/auth/logout"), { method: "POST" });
    } catch {
      // 即使请求失败也清掉前端状态并回登录页
    } finally {
      router.replace("/login");
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--panel)]/80 backdrop-blur-md z-40">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Link href="/" className="shrink-0 font-display text-lg tracking-tight text-[var(--ink)]">
            CrazyWords
          </Link>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <nav className="flex flex-wrap justify-end gap-1 text-sm">
              {NAV.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      active
                        ? "bg-[var(--ink)] text-[var(--paper)]"
                        : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--chip)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {user && (
              <div className="hidden shrink-0 items-center gap-2 border-l border-[var(--line)] pl-3 sm:flex">
                <span
                  className="max-w-32 truncate text-sm font-medium text-[var(--ink)]"
                  title={user.username}
                >
                  {user.username}
                </span>
                <span className={`badge ${isAdmin ? "badge-warn" : ""}`}>
                  {isAdmin ? "管理员" : "普通用户"}
                </span>
                {isAdmin && (
                  <Link
                    href="/admin"
                    className={`rounded-md px-2 py-1 text-xs transition-colors ${
                      pathname.startsWith("/admin")
                        ? "bg-[var(--ink)] text-[var(--paper)]"
                        : "text-[var(--teal)] hover:bg-[var(--chip)]"
                    }`}
                  >
                    用户管理
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void logout()}
                  disabled={loggingOut}
                  className="rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"
                >
                  {loggingOut ? "退出中…" : "退出"}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="no-scrollbar mx-auto w-full max-w-5xl flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {children}
      </main>
    </div>
  );
}
