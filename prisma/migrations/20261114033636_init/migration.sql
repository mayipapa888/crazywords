-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "dailyGoalDefault" INTEGER NOT NULL DEFAULT 20,
    "clozeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WordList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'import',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WordList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WordEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "glossZh" TEXT,
    "ipa" TEXT,
    "pos" TEXT,
    "example" TEXT,
    "phrases" TEXT NOT NULL DEFAULT '[]',
    "related" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WordEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "WordList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "dueAt" DATETIME,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastResult" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CardState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardState_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WordEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WrongBookItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "wrongCount" INTEGER NOT NULL DEFAULT 1,
    "lastWrongAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWrongKinds" TEXT NOT NULL DEFAULT 'both',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "consecutiveOk" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WrongBookItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WrongBookItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WordEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "goalN" INTEGER NOT NULL,
    "queueSnapshot" TEXT NOT NULL DEFAULT '[]',
    "clozeEnabledSnapshot" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "spellingInput" TEXT NOT NULL,
    "spellingOk" BOOLEAN NOT NULL,
    "asrTranscript" TEXT,
    "pronunciationOk" BOOLEAN NOT NULL,
    "overallOk" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attempt_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WordEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WordList_userId_idx" ON "WordList"("userId");

-- CreateIndex
CREATE INDEX "WordEntry_listId_idx" ON "WordEntry"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "WordEntry_listId_word_key" ON "WordEntry"("listId", "word");

-- CreateIndex
CREATE INDEX "CardState_userId_dueAt_idx" ON "CardState"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "CardState_userId_status_idx" ON "CardState"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardState_userId_entryId_key" ON "CardState"("userId", "entryId");

-- CreateIndex
CREATE INDEX "WrongBookItem_userId_active_idx" ON "WrongBookItem"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WrongBookItem_userId_entryId_key" ON "WrongBookItem"("userId", "entryId");

-- CreateIndex
CREATE INDEX "Session_userId_date_idx" ON "Session"("userId", "date");

-- CreateIndex
CREATE INDEX "Attempt_sessionId_idx" ON "Attempt"("sessionId");

-- CreateIndex
CREATE INDEX "Attempt_entryId_idx" ON "Attempt"("entryId");
