-- CreateTable（只新增在线对战票据表，不改动已有表）
CREATE TABLE "OnlineTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlineTicket_token_key" ON "OnlineTicket"("token");

-- CreateIndex（定时清理过期票据用）
CREATE INDEX "OnlineTicket_expiresAt_idx" ON "OnlineTicket"("expiresAt");
