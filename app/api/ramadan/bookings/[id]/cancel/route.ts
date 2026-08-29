import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { cancelLegacyRamadanBooking } from "@/lib/services/ramadan";

type Ctx = { params: Promise<{ id: string }> };

/**
 * WS-9.3 — POST /api/ramadan/bookings/[id]/cancel
 *
 * The ONLY write left on the legacy booking tables, and only in the releasing
 * direction. A legacy row holds its physical table for a whole day; with the
 * legacy create path closed there would otherwise be no way to free a table
 * whose guest cancelled, and the seat would stay off the market for the rest of
 * Ramadan. Branch manager of that branch, super admin, or the booking's own
 * customer — enforced server-side in the service.
 */
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const booking = await cancelLegacyRamadanBooking(me, Number(id));
  return json({ id: booking.id, status: booking.status });
});
