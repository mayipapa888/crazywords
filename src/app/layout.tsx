import type { Metadata } from "next";
import { Noto_Sans_SC, Syne } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const syne = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const noto = Noto_Sans_SC({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

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
      <body className={`${syne.variable} ${noto.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
