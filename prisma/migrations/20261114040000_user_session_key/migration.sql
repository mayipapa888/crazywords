-- AlterTable
ALTER TABLE "User" ADD COLUMN "sessionKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_sessionKey_key" ON "User"("sessionKey");
