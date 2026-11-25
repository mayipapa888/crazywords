import { randomBytes } from "node:crypto";
import type { AuthResult } from "@/lib/auth";
import { errorJson, jsonWithSession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 在线对战连接票据。
 *
 * 流程：已登录用户 POST 本接口 → 得到 32 字节 hex（60 秒内一次性）→
 * 浏览器用它连接独立 WS 服务 `wss://<host>/ws?ticket=...`。
 * 两个进程通过 OnlineTicket 表共享票据；WS 端消费（used=true）后即不可复用。
 *
 * 契约：200 { ok: true, ticket, expiresAt, username }
 *       401 { error: "请先登录" }
 */
export const dynamic = "force-dynamic";

const TICKET_TTL_MS = 60_000;
/** 过期超过 10 分钟的票据顺手清掉，避免表无限增长（有效票据绝不删除） */
const STALE_TICKET_MS = 10 * 60_000;

export async function POST(req: Request) {
  let auth: AuthResult | null = null;
  try {
    auth = await requireUser(req);
    const username = auth.user.username?.trim() || "玩家";
    const now = new Date();
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(now.getTime() + TICKET_TTL_MS);

    await prisma.$transaction([
      prisma.onlineTicket.deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - STALE_TICKET_MS) } },
      }),
      prisma.onlineTicket.create({
        data: {
          token,
          userId: auth.user.id,
          username,
          expiresAt,
        },
      }),
    ]);

    return jsonWithSession(
      {
        ok: true,
        ticket: token,
        expiresAt: expiresAt.toISOString(),
        username,
      },
      auth,
    );
  } catch (e) {
    return errorJson(e, 400);
  }
}
