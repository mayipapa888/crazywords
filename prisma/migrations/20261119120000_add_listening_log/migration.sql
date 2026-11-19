-- CreateTable
CREATE TABLE "ListeningLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ListeningLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ListeningLog_userId_date_idx" ON "ListeningLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ListeningLog_userId_date_key" ON "ListeningLog"("userId", "date");
