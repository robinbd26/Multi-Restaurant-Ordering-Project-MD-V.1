import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Activity Logs types written by admin removals. "archive" = hidden but every
 * record kept (history exists); "delete" = the row is gone for good (pure setup
 * data). Everything else stays the long-standing "action".
 */
export type AdminActionType = "archive" | "delete" | "action";

/**
 * ONE place every admin delete and archive is written to Activity Logs, so no
 * removal is silent and all of them read the same way.
 *
 * The description must name the thing (and its id): after a permanent delete
 * there is no row left to join to, and a branch delete nulls the log's
 * branchId, so the text is the only record of what was removed.
 *
 * Pass `tx` to write inside the same transaction as the change, so a rolled
 * back delete never leaves a log saying it happened.
 */
export async function logAdminAction(
  actorId: number,
  type: AdminActionType,
  description: string,
  options: { branchId?: number | null; tx?: Prisma.TransactionClient } = {},
): Promise<void> {
  const db = options.tx ?? prisma;
  await db.managerActivityLog.create({
    data: {
      managerId: actorId,
      branchId: options.branchId ?? null,
      activityType: type,
      description,
    },
  });
}
