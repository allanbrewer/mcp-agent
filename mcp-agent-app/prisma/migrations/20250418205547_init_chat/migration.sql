-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastModified" DATETIME NOT NULL,
    "history" JSONB NOT NULL,
    "systemPrompt" TEXT
);

-- CreateIndex
CREATE INDEX "Chat_userId_idx" ON "Chat"("userId");
