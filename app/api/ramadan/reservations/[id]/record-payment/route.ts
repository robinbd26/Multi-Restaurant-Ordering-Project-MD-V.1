import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { recordOfflineRamadanAdvance, serializePayment, serializeReservation } from "@/lib/services/ramadan";

type Ctx = { params: Promise<{ id: string }> };
// POST /api/ramadan/reservations/[id]/record-payment  { reference, amount?, note? } — WS-1.3.
//
// The ONLY non-gateway way an advance can be marked paid: accounts, super admin
// or the reservation's OWN branch manager records money taken at the counter.
// The service re-checks the role against the reservation's branch and stamps
// recordedById + source="offline_recorded", so the row is never mistaken for a
// gateway settlement in the Ramadan summary or the financial audit log.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { reference?: unknown; amount?: unknown; note?: unknown };
  const { payment, reservation } = await recordOfflineRamadanAdvance(me, Number(id), {
    reference: b.reference, amount: b.amount, note: b.note,
  });
  return json({ payment: serializePayment(payment), reservation: serializeReservation(reservation) });
});
