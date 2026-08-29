import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { created, pageParams, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { generateSettlement } from "@/lib/services/financials";
import { dhakaDayKey } from "@/lib/utils/dates";

function serialize(s: {
  id: number;
  branchId: number;
  date: Date;
  orders: number;
  sales: { toFixed(n: number): string };
  commission: { toFixed(n: number): string };
  expenses: { toFixed(n: number): string };
  net: { toFixed(n: number): string };
  createdAt: Date;
  branch?: { name: string } | null;
  generatedBy?: { firstName: string; lastName: string; username: string } | null;
}) {
  return {
    id: s.id,
    branch: s.branchId,
    branch_name: s.branch?.name ?? "",
    // WS-2.7 — the settlement's business day is a DHAKA day. `toISOString()`
    // reports the UTC calendar date, which for a Dhaka midnight instant is the
    // PREVIOUS day — the settlement would have been labelled with a date the
    // branch never traded on.
    date: dhakaDayKey(s.date),
    orders: s.orders,
    sales: s.sales.toFixed(2),
    commission: s.commission.toFixed(2),
    expenses: s.expenses.toFixed(2),
    net: s.net.toFixed(2),
    generated_by_name: s.generatedBy
      ? `${s.generatedBy.firstName} ${s.generatedBy.lastName}`.trim() || s.generatedBy.username
      : null,
    created_at: s.createdAt.toISOString(),
  };
}

// GET /api/accounts/settlements
export const GET = handle(async (req: Request) => {
  await requireApiRole("accounts", "super_admin", "management");
  const url = new URL(req.url);
  const { skip, take, page, pageSize } = pageParams(url);
  const [count, items] = await Promise.all([
    prisma.branchSettlement.count(),
    prisma.branchSettlement.findMany({
      include: { branch: true, generatedBy: true },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
  ]);
  return paginated(items.map(serialize), { page, pageSize, count });
});

// POST /api/accounts/settlements  { branch_id, date } — generate end-of-day snapshot.
//
// WS-2.1 — the stored `net` also subtracts refunds paid out and applies
// authorised financial adjustments. BranchSettlement has no column for either
// (schema frozen), so the components come back on the create response and the
// full formula is written to the financial audit log.
//
// WS-2.7 — the day is now the DHAKA business day and the takings are bucketed by
// DELIVERY time (the OrderStatusEvent trail), not by when the order was placed,
// so a branch's end-of-day finally reconciles against the cash actually handed
// in. The cash reconciliation travels with the response for exactly that check.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("accounts", "super_admin");
  const body = (await req.json().catch(() => ({}))) as { branch_id?: number; date?: string };
  const { breakdown, reconciliation, ...settlement } = await generateSettlement(
    me,
    Number(body.branch_id),
    String(body.date ?? ""),
  );
  return created({
    ...serialize(settlement),
    breakdown: {
      gross_sales: breakdown.sales.toFixed(2),
      food_revenue: breakdown.foodRevenue.toFixed(2),
      delivery_revenue: breakdown.deliveryRevenue.toFixed(2),
      refunds: breakdown.refunds.toFixed(2),
      commission: breakdown.commission.toFixed(2),
      expenses: breakdown.expenses.toFixed(2),
      adjustments_credit: breakdown.adjustmentsCredit.toFixed(2),
      adjustments_debit: breakdown.adjustmentsDebit.toFixed(2),
      adjustments_net: breakdown.adjustments.toFixed(2),
      net_revenue: breakdown.netRevenue.toFixed(2),
    },
    // What the branch should physically be holding for the day.
    cash: {
      collected: reconciliation.collected.toFixed(2),
      cash_collected: reconciliation.cashCollected.toFixed(2),
      digital_collected: reconciliation.digitalCollected.toFixed(2),
      refunded: reconciliation.refunded.toFixed(2),
      expected_in_hand: reconciliation.expectedInHand.toFixed(2),
    },
  });
});
