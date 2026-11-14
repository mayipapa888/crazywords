import { prisma } from "./db";

/** MVP：单演示用户，无魔法链接鉴权。 */
export async function getOrCreateDemoUser() {
  const existing = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      locale: "zh-CN",
      dailyGoalDefault: 20,
      clozeEnabled: true,
    },
  });
}
