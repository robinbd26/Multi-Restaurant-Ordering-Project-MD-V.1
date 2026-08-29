import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { serializePayment, serializeReservation, startRamadanAdvancePayment } from "@/lib/services/ramadan";

type Ctx = { params: Promise<{ id: string }> };
// POST /api/ramadan/reservations/[id]/pay — WS-1.3.
//
// STARTS a real gateway advance payment and returns the URL the customer must
// be sent to. The old client-asserted `{outcome, gateway_ref}` path is GONE:
// this endpoint reads NOTHING from the request body, so posting
// `{outcome:"success"}` can no longer book a free iftar table. The booking is
// settled only by /api/payments/gateway/callback/ramadan, after the amount is
// verified against the gateway server-side.
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const me = await requireApproved();
  const { id } = await ctx.params;
  const { payment, reservation, redirectUrl, provider } = await startRamadanAdvancePayment(me, Number(id));
  return json({
    payment: serializePayment(payment),
    reservation: serializeReservation(reservation),
    redirect_url: redirectUrl,
    provider,
  });
});
