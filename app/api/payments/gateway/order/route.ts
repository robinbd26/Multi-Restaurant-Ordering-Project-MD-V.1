import { requireApiRole } from "@/lib/auth/current-user";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { startOrderGatewayPayment } from "@/lib/services/payments";

// POST /api/payments/gateway/order  { order_id } — WS-1.1.
//
// The CUSTOMER asks for a gateway payment on their OWN order. The order id is
// the only thing read from the body and it is re-checked against the session
// user server-side; the AMOUNT is taken from Order.totalAmount and never from
// the client. The response is just a URL to redirect the browser to — no money
// has moved and the order is still unpaid at this point.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const body = (await req.json().catch(() => ({}))) as { order_id?: unknown };
  const orderId = Number(body.order_id);
  // A missing/non-numeric id must be a FIELD ERROR, not a Prisma 500.
  if (!Number.isInteger(orderId) || orderId <= 0) throw validationError({ order_id: sk("errors.ops.idRequired") });
  const started = await startOrderGatewayPayment(me, orderId);
  return json({ payment_id: started.paymentId, redirect_url: started.redirectUrl, provider: started.provider });
});
