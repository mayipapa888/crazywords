"use client";

import { withBase } from "@/lib/base-path";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

export type SessionUser = {
  id: string;
  username: string;
  role: string;
};

type SessionValue = {
  user: SessionUser | null;
  ready: boolean;
};

const SessionContext = createContext<SessionValue>({ user: null, ready: false });

/** 业务组件读取当前登录用户（由 SessionBootstrap 统一拉取，避免重复请求）。 */
export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/** 登录 / 注册页自身放行，否则未登录访问它们会反复跳向自己。 */
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

/**
 * 会话引导：
 * 1. 每次进入登录态边界（登录页 ↔ 业务页）时调用 GET /api/auth/me；
 * 2. user === null 且当前不是登录/注册页 → router.replace("/login")；
 * 3. 拿到用户后才渲染子内容，未登录时不会让业务页先发一堆 401 请求。
 */
export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const authPage = isAuthPage(pathname);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let nextUser: SessionUser | null = null;
      try {
        const res = await fetch(withBase("/api/auth/me"), { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { user?: SessionUser | null };
          nextUser = data.user ?? null;
        }
      } catch {
        // 网络异常按未登录处理：登录页继续展示表单，业务页回登录页
      }
      if (cancelled) return;

      if (nextUser) {
        setUser(nextUser);
        setReady(true);
        return;
      }

      setUser(null);
      if (authPage) {
        setReady(true);
        return;
      }

      router.replace("/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [authPage, router]);

  // 登录 / 注册页无需等待会话探测，先渲染表单；业务页必须确认登录态
  if (!ready && !authPage) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--muted)]">
        正在验证登录状态…
      </div>
    );
  }

  if (!authPage && !user) {
    // 已触发 redirect 或刚登录成功正在刷新会话；不要渲染业务页
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--muted)]">
        正在加载…
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ user, ready }}>
      {children}
    </SessionContext.Provider>
  );
}
