import { NextResponse } from "next/server";
import { errorJson, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 账号列表：仅管理员可见。
 * 只返回已注册账号（username 非空），历史匿名用户不出现在后台。
 * 排序：pending 优先，其余按 createdAt 倒序。
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    if (auth.user.role !== "admin") {
      return NextResponse.json({ error: "仅管理员可访问" }, { status: 403 });
    }

    const rows = await prisma.user.findMany({
      where: { username: { not: null } },
      select: {
        id: true,
        username: true,
        status: true,
        role: true,
        createdAt: true,
      },
      // 先按创建时间倒序；再用稳定排序把 pending 提到最前
      orderBy: { createdAt: "desc" },
    });

    const users = rows.sort(
      (a, b) => Number(b.status === "pending") - Number(a.status === "pending"),
    );

    return NextResponse.json({ users });
  } catch (e) {
    return errorJson(e, 500);
  }
}
