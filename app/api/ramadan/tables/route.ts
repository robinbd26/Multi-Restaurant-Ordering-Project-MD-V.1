import { requireApproved } from "@/lib/auth/current-user";
import { conflict, handle, sk } from "@/lib/http/errors";
import { paginated } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { branchForManager } from "@/lib/selectors";

/**
 * WS-9.3 — LEGACY (System 1) Ramadan table registry.
 *
 * DEPRECATED, READ-ONLY. Ramadan seating is the branch's REAL table layout
 * (`BranchTable`, managed at /api/branch-tables and drawn by the layout editor
 * in the Ramadan section), which is also what normal table reservations use —
 * that shared row is what makes double-booking impossible. This registry was a
 * second, invisible set of tables with no link to the physical room.
 *
 * It stays readable so a legacy booking can still name the table it holds; it
 * is never written again. Retirement: see the WS-9.3 migration plan.
 */

function serialize(t: { id: number; name: string; capacity: number; isActive: boolean; branchId: number }) {
  return { id: t.id, name: t.name, capacity: t.capacity, is_active: t.isActive, branch: t.branchId, is_legacy: true };
}

// GET /api/ramadan/tables?branch= — BM sees own; everyone else a named branch.
export const GET = handle(async (req: Request) => {
  const me = await requireApproved();
  let branchId: number | undefined;
  if (me.role === "branch_manager") {
    const branch = await branchForManager(me.id);
    branchId = branch?.id ?? -1;
  } else {
    const q = new URL(req.url).searchParams.get("branch");
    branchId = q ? Number(q) : undefined;
  }
  const tables = await prisma.ramadanTable.findMany({
    where: branchId ? { branchId } : {},
    orderBy: { name: "asc" },
  });
  return paginated(tables.map(serialize));
});

// POST /api/ramadan/tables — CLOSED. Tables are configured on the real layout.
export const POST = handle(async () => {
  await requireApproved();
  throw conflict(sk("errors.ramadan.legacyTableWriteClosed"));
});
