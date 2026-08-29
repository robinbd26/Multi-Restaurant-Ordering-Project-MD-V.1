import { requireApproved } from "@/lib/auth/current-user";
import { conflict, handle, sk } from "@/lib/http/errors";
import { paginated } from "@/lib/http/respond";
import { legacyRamadanBookings } from "@/lib/services/ramadan";

/**
 * WS-9.3 — LEGACY (System 1) Ramadan bookings: RamadanTable + RamadanBooking.
 *
 * DEPRECATED, READ-ONLY. The canonical booking path is
 * POST /api/ramadan/reservations, which seats a booking on the shared physical
 * BranchTable and carries the iftar slot, the platter and the advance payment.
 * This endpoint stays only so bookings made before unification remain visible
 * to the customer who made them and the branch that has to honour them; those
 * rows still HOLD their table (see `legacyHoldsForDay`), so nothing can be
 * double-booked while they exist.
 *
 * Retirement: once the legacy rows have been migrated onto RamadanReservation
 * (see the WS-9.3 migration plan), this route and both legacy models go.
 */

// GET /api/ramadan/bookings — role-scoped legacy bookings (BM branch / customer own).
export const GET = handle(async (req: Request) => {
  const me = await requireApproved();
  const url = new URL(req.url);
  const branchId = url.searchParams.get("branch_id");
  const rows = await legacyRamadanBookings(me, {
    branchId: branchId ? Number(branchId) : undefined,
    limit: url.searchParams.get("page_size") ? Number(url.searchParams.get("page_size")) : undefined,
  });
  return paginated(rows);
});

// POST /api/ramadan/bookings — CLOSED. New bookings go through the canonical path.
export const POST = handle(async () => {
  await requireApproved();
  throw conflict(sk("errors.ramadan.legacyWriteClosed"));
});
