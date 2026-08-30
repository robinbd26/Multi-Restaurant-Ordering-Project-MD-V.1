import type { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { created, pageParams, paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { EXPENSE_CATEGORIES, recordExpense, type ExpenseCategory } from "@/lib/services/financials";
import { dhakaDayEndFromKey, dhakaDayKey, dhakaDayStartFromKey } from "@/lib/utils/dates";

function serialize(e: {
  id: number;
  branchId: number;
  category: string;
  amount: { toFixed(n: number): string };
  note: string;
  expenseDate: Date;
  createdAt: Date;
  branch?: { name: string } | null;
  createdBy?: { firstName: string; lastName: string; username: string } | null;
}) {
  return {
    id: e.id,
    branch: e.branchId,
    branch_name: e.branch?.name ?? "",
    category: e.category,
    amount: e.amount.toFixed(2),
    note: e.note,
    // WS-2.7 — an expense is filed against a DHAKA business day, and it is now
    // STORED as Dhaka midnight. `toISOString()` reports the UTC calendar date,
    // which for a Dhaka midnight instant is the previous day.
    expense_date: dhakaDayKey(e.expenseDate),
    created_by_name: e.createdBy
      ? `${e.createdBy.firstName} ${e.createdBy.lastName}`.trim() || e.createdBy.username
      : null,
    created_at: e.createdAt.toISOString(),
  };
}

// GET /api/accounts/expenses?branch=&category=&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// WS-2.10 — the date window filters on the DHAKA business day the expense was
// filed against (expenseDate), matching how recordExpense stores it. A category
// outside the known list is ignored rather than silently matching nothing.
export const GET = handle(async (req: Request) => {
  await requireApiRole("accounts", "super_admin", "management");
  const url = new URL(req.url);
  const { skip, take, page, pageSize } = pageParams(url);
  const where: Prisma.BranchExpenseWhereInput = {};
  const branch = url.searchParams.get("branch");
  const category = url.searchParams.get("category");
  if (branch && Number.isInteger(Number(branch))) where.branchId = Number(branch);
  if (category && EXPENSE_CATEGORIES.includes(category as ExpenseCategory)) {
    where.category = category;
  }
  const fromAt = dhakaDayStartFromKey(url.searchParams.get("from") ?? "");
  const toAt = dhakaDayEndFromKey(url.searchParams.get("to") ?? "");
  if (fromAt || toAt) {
    where.expenseDate = { ...(fromAt ? { gte: fromAt } : {}), ...(toAt ? { lte: toAt } : {}) };
  }

  const [count, items] = await Promise.all([
    prisma.branchExpense.count({ where }),
    prisma.branchExpense.findMany({
      where,
      include: { branch: true, createdBy: true },
      orderBy: { expenseDate: "desc" },
      skip,
      take,
    }),
  ]);
  return paginated(items.map(serialize), { page, pageSize, count });
});

// POST /api/accounts/expenses  { branch_id, category, amount, note, expense_date }
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("accounts", "super_admin");
  const body = (await req.json().catch(() => ({}))) as {
    branch_id?: number;
    category?: string;
    amount?: string | number;
    note?: string;
    expense_date?: string;
  };
  const expense = await recordExpense(me, {
    branchId: Number(body.branch_id),
    category: String(body.category ?? ""),
    amount: String(body.amount ?? ""),
    note: String(body.note ?? ""),
    expenseDate: String(body.expense_date ?? ""),
  });
  return created(serialize(expense));
});
