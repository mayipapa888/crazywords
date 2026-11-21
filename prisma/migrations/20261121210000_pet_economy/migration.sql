-- AlterTable（只加列，不重建表；SQLite 允许带常量默认值的 ADD COLUMN）
ALTER TABLE "Pet" ADD COLUMN "milestoneIssued" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Pet" ADD COLUMN "feedCountToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Pet" ADD COLUMN "feedDate" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "BattleRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'playing',
    "kills" INTEGER NOT NULL DEFAULT 0,
    "placement" INTEGER NOT NULL DEFAULT 0,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "expGained" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "BattleRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BattleRecord_userId_createdAt_idx" ON "BattleRecord"("userId", "createdAt");

-- CreateTable
CREATE TABLE "PointSpend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointSpend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PointSpend_userId_createdAt_idx" ON "PointSpend"("userId", "createdAt");
