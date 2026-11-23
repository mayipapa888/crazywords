-- AlterTable（只加列；历史匿名用户新列为 NULL / 默认值）
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';

-- CreateIndex（SQLite 唯一索引允许多个 NULL，历史匿名用户不冲突）
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
