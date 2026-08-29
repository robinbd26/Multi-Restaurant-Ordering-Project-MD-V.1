import { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { pageParams, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { serializeWithdrawal } from "@/lib/serializers";
import { WITHDRAWAL_STATUSES } from "@/lib/constants/enums";
import { WITHDRAWAL_INCLUDE } from "@/lib/services/wallet";
import { dhakaAddDays, dhakaDayStartFromKey } from "@/lib/utils/dates";

// GET /api/accounts/withdrawals — rider withdrawal requests.
//   ?status= &rider= &from=YYYY-MM-DD &to=YYYY-MM-DD
//
// WS-2.6 — the payout queue could only be narrowed by status, so "what did we
// pay out last month?" was unanswerable on this screen. The date window is a
// DHAKA one (lib/utils/dates.ts owns the business day), and it is applied to the
// timestamp that matches the question being asked: a PAID filter is about when
// the money left (`paidAt`), everything else about when it was requested.
export const GET = handle(async (req: Request) => {
  await requireApiRole("accounts", "super_admin");
  const url = new URL(req.url);
  const { skip, take, page, pageSize } = pageParams(url);

  const where: Prisma.RiderWithdrawalWhereInput = {};
  const status = url.searchParams.get("status");
  if (status && (WITHDRAWAL_STATUSES as readonly string[]).includes(status)) where.status = status;

  const rider = Number(url.searchParams.get("rider"));
  if (Number.isInteger(rider) && rider > 0) where.riderId = rider;

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromAt = from ? dhakaDayStartFromKey(from) : null;
  const toStart = to ? dhakaDayStartFromKey(to) : null;
  // The `to` day is inclusive to the reader; the query bound is the start of the
  // next Dhaka day, so the final second of the day is never dropped.
  const toAt = toStart ? dhakaAddDays(toStart, 1) : null;
  if (fromAt || toAt) {
    const range = { ...(fromAt ? { gte: fromAt } : {}), ...(toAt ? { lt: toAt } : {}) };
    if (status === "paid") where.paidAt = range;
    else where.createdAt = range;
  }

  const [count, items] = await Promise.all([
    prisma.riderWithdrawal.count({ where }),
    prisma.riderWithdrawal.findMany({
      where,
      include: WITHDRAWAL_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);
  return paginated(items.map(serializeWithdrawal), { page, pageSize, count });
});
