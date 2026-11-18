"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/lookup", label: "查词" },
  { href: "/dictation", label: "听写" },
  { href: "/wrong-book", label: "错题本" },
  { href: "/wordbook", label: "单词本" },
  { href: "/notes", label: "知识点" },
  { href: "/words", label: "词库维护" },
  { href: "/calendar", label: "打卡" },
  { href: "/settings", label: "设置" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--panel)]/80 backdrop-blur-md z-40">
        <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-lg tracking-tight text-[var(--ink)]">
            CrazyWords
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
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
        </div>
      </header>
      <main className="no-scrollbar mx-auto w-full max-w-5xl flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {children}
      </main>
    </div>
  );
}
