import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/** 当前登录用户；未登录（或非 active）时返回 null，不抛错。 */
export async function GET(req: Request) {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  try {
    const sid = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (!sid) {
      return NextResponse.json({ user: null }, noStore);
    }

    const user = await prisma.user.findUnique({ where: { sessionKey: sid } });
    if (!user || user.status !== "active" || !user.username) {
      return NextResponse.json({ user: null }, noStore);
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      },
      noStore,
    );
  } catch {
    return NextResponse.json({ user: null }, noStore);
  }
}
