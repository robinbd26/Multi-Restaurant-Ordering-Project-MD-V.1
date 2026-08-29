import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json, pageParams } from "@/lib/http/respond";
import { commissionLedger } from "@/lib/services/wallet";
import { dhakaAddDays, dhakaDayStartFromKey } from "@/lib/utils/dates";

/** A positive integer query parameter, or undefined. */
function idParam(url: URL, key: string): number | undefined {
  const raw = Number(url.searchParams.get(key));
  return Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

// GET /api/accounts/commissions — individual RiderCommission rows.
//   ?rider= &branch= &order= &from=YYYY-MM-DD &to=YYYY-MM-DD &page= &page_size=
//
// WS-2.8 — no route or page listed individual commission rows: Accounts could
// see a rider's lifetime TOTAL and nothing behind it, so a disputed payout could
// not be traced to the deliveries that earned it. Totals come back for the WHOLE
// filtered set (a database-side sum), never just the visible page — a page total
// tells an accountant nothing about what is owed.
//
// The envelope is hand-rolled rather than `paginated()` because the totals must
// ride alongside `results`; the results/count/next/previous shape is identical.
export const GET = handle(async (req: Request) => {
  await requireApiRole("accounts", "super_admin", "management");
  const url = new URL(req.url);
  const { skip, take } = pageParams(url);

  const fromKey = url.searchParams.get("from") ?? "";
  const toKey = url.searchParams.get("to") ?? "";
  const from = fromKey ? dhakaDayStartFromKey(fromKey) : null;
  // The filter's `to` day is INCLUSIVE to the reader, so the (exclusive) window
  // ends at the start of the NEXT Dhaka day. Never `T23:59:59` — that silently
  // drops anything recorded in the final second of the day.
  const toStart = toKey ? dhakaDayStartFromKey(toKey) : null;
  const to = toStart ? dhakaAddDays(toStart, 1) : null;

  const ledger = await commissionLedger(
    {
      riderId: idParam(url, "rider"),
      branchId: idParam(url, "branch"),
      orderId: idParam(url, "order"),
      from: from ?? undefined,
      to: to ?? undefined,
    },
    { skip, take },
  );

  return json({
    count: ledger.count,
    next: null,
    previous: null,
    totals: {
      commission: ledger.total.toFixed(2),
      records: ledger.count,
      riders: ledger.riders,
    },
    results: ledger.rows.map((r) => ({
      id: r.id,
      order: r.orderId,
      order_number: r.orderNumber,
      rider: r.riderId,
      rider_name: r.riderName,
      rider_username: r.riderUsername,
      branch: r.branchId,
      branch_name: r.branchName,
      // The rate snapshotted when the delivery completed — never recomputed
      // from today's rule.
      amount: r.amount.toFixed(2),
      order_total: r.orderTotal.toFixed(2),
      created_at: r.createdAt.toISOString(),
    })),
  });
});
