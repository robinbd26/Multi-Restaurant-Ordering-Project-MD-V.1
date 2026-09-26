import path from "node:path";

import { PrismaClient } from "@prisma/client";

/**
 * Direct access to the ISOLATED E2E database (prisma/test.db — see
 * playwright.config.ts) for the order-chat spec ONLY. Deliberately NOT
 * re-exported from helpers/index.ts, same as reset-tokens.ts, so the Prisma
 * client is loaded solely by the spec that needs it.
 *
 * WHY: the chat goes read-only 2 hours after the order ends, and a test cannot
 * wait 2 hours. Moving the recorded end time back is the one thing done here;
 * the read-only decision itself is still the server's own code, reached
 * through the real API. It also reads a chat photo's storage key, which the API
 * deliberately never exposes, to prove the generic uploads route refuses it.
 */
const prisma = new PrismaClient({
  datasourceUrl: `file:${path
    .join(process.cwd(), "prisma", "test.db")
    .replace(/\\/g, "/")}?connection_limit=1&socket_timeout=30&pool_timeout=60`,
});

/** Pretend the order ended `hoursAgo` hours ago (it must already have ended). */
export async function backdateChatEnd(orderId: number, hoursAgo: number): Promise<void> {
  const chat = await prisma.orderChat.findUnique({ where: { orderId } });
  if (!chat?.endedAt) throw new Error(`E2E: order ${orderId} has no ended chat to backdate`);
  await prisma.orderChat.update({
    where: { orderId },
    data: { endedAt: new Date(Date.now() - hoursAgo * 3600_000) },
  });
}

/** The storage key of a chat photo message. */
export async function chatPhotoKey(messageId: number): Promise<string> {
  const message = await prisma.orderChatMessage.findUnique({ where: { id: messageId } });
  if (!message?.imageKey) throw new Error(`E2E: message ${messageId} has no photo`);
  return message.imageKey;
}
