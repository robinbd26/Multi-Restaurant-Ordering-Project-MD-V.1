-- Per-order chat (docs/order-chat-plan.md).
--
-- Additive only: three new tables, nothing existing is altered or dropped.
-- The superseded rider<->customer delivery chat tables are left in place
-- (no longer written) so this migration can be rolled back without loss.

-- CreateTable
CREATE TABLE "OrderChat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderChat_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderChatMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" INTEGER NOT NULL,
    "senderId" INTEGER,
    "senderRole" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL DEFAULT '',
    "imageKey" TEXT,
    "params" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "OrderChat" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderChatRead" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "lastReadMessageId" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderChatRead_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "OrderChat" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderChat_orderId_key" ON "OrderChat"("orderId");

-- CreateIndex
CREATE INDEX "OrderChatMessage_chatId_id_idx" ON "OrderChatMessage"("chatId", "id");

-- CreateIndex
CREATE INDEX "OrderChatRead_userId_idx" ON "OrderChatRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderChatRead_chatId_userId_key" ON "OrderChatRead"("chatId", "userId");


-- Carry the old delivery chat history over, so nothing a customer or rider
-- wrote disappears from the order page. One chat per order that had any
-- delivery thread (an order could have one thread per rider), then every
-- message in its original order. Every FK target exists: the source rows
-- cascade from Order and User, so the copy cannot fail on anyone's data.
-- The sender's badge: "rider" when they were that thread's rider, otherwise
-- the thread's customer. Chats for all other existing orders are created on
-- first access (upsert on the unique orderId), not here.
INSERT INTO "OrderChat" ("orderId", "createdAt", "updatedAt")
SELECT t."orderId", MIN(t."createdAt"), MAX(t."updatedAt")
FROM "OrderDeliveryChatThread" t
GROUP BY t."orderId";

INSERT INTO "OrderChatMessage" ("chatId", "senderId", "senderRole", "kind", "body", "createdAt")
SELECT c."id",
       m."senderId",
       CASE WHEN m."senderId" = t."riderId" THEN 'rider' ELSE 'customer' END,
       'text',
       m."body",
       m."createdAt"
FROM "OrderDeliveryChatMessage" m
JOIN "OrderDeliveryChatThread" t ON t."id" = m."threadId"
JOIN "OrderChat" c ON c."orderId" = t."orderId"
ORDER BY m."createdAt", m."id";
