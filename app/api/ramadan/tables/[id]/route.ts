import { requireApproved } from "@/lib/auth/current-user";
import { conflict, handle, sk } from "@/lib/http/errors";

/**
 * WS-9.3 — DELETE /api/ramadan/tables/[id] is CLOSED.
 *
 * Deleting a legacy table cascades its bookings away, which would silently
 * destroy reservations the branch still has to honour, and Ramadan seating is
 * now the real `BranchTable` layout anyway (DELETE /api/branch-tables/[id]).
 * The legacy registry is read-only until the retirement migration removes it.
 */
export const DELETE = handle(async () => {
  await requireApproved();
  throw conflict(sk("errors.ramadan.legacyTableWriteClosed"));
});
