import { requireApproved } from "@/lib/auth/current-user";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import { serializeTable } from "@/lib/services/branch-ops";
import {
  eligibleMenus,
  getConfig,
  ramadanTableAvailability,
  serializeConfig,
  serializeMenu,
  serializeSlot,
  slotsForBranch,
  type TableAvailabilityRow,
} from "@/lib/services/ramadan";

// GET /api/ramadan/available?branch_id=&date=&slot_id=
// Customer booking helper: config, active slots, bookable tables, and menus
// eligible for the branch/date/slot. Menus are filtered server-side.
export const GET = handle(async (req: Request) => {
  await requireApproved();
  const url = new URL(req.url);
  const branchId = Number(url.searchParams.get("branch_id"));
  if (!branchId) throw validationError({ branch_id: sk("errors.ops.branchRequired") });
  const branch = await prisma.branch.findFirst({ where: { id: branchId, isActive: true } });
  if (!branch) throw validationError({ branch_id: sk("errors.ops.branchRequired") });

  const config = await getConfig(branchId);
  const slots = await slotsForBranch(branchId, true);
  const dateStr = url.searchParams.get("date");
  const dayKey = dateStr && /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : "";
  const slotId = url.searchParams.get("slot_id") ? Number(url.searchParams.get("slot_id")) : null;

  // WS-9.3 — availability is read across BOTH Ramadan booking systems and the
  // normal table reservations, so a legacy booking still holds its table. Until
  // a date is chosen there is nothing to check against, so every active table is
  // offered (the create path re-checks in its transaction regardless).
  const availability = dayKey
    ? await ramadanTableAvailability(branchId, dayKey, slotId)
    : null;
  const rows: TableAvailabilityRow[] = availability
    ? availability.rows
    : (await prisma.branchTable.findMany({
        where: { branchId, isActive: true, status: { not: "out_of_service" } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      })).map((table) => ({ table, available: true, reason: "", heldFor: "" }));

  // A table someone already holds must not be offered: the picker never had an
  // availability filter, which is how the same seat reached two customers.
  const tables = rows.filter((r) => r.available).map((r) => serializeTable(r.table));
  const blockedTables = rows
    .filter((r) => !r.available)
    .map((r) => ({ id: r.table.id, name: r.table.name, reason: r.reason, held_for: r.heldFor }));

  let menus: ReturnType<typeof serializeMenu>[] = [];
  if (dayKey) {
    const date = new Date(`${dayKey}T00:00:00.000Z`);
    menus = (await eligibleMenus(branchId, date, slotId)).map(serializeMenu);
  }
  return json({
    config: serializeConfig(config, branchId),
    slots: slots.map(serializeSlot),
    tables,
    blocked_tables: blockedTables,
    // Remaining guest capacity for the chosen slot; null = unlimited or no slot.
    slot_remaining: availability?.slotRemaining ?? null,
    menus,
  });
});
