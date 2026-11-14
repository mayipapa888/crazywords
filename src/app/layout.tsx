import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { SessionBootstrap } from "@/components/SessionBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "CrazyWords — 语音听写背单词",
  description: "导入自有词表，语音辅助一对一听写，按记忆曲线复习。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <SessionBootstrap>
          <AppShell>{children}</AppShell>
        </SessionBootstrap>
      </body>
    </html>
  );
}
