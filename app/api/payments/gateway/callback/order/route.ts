import { NextResponse } from "next/server";

import { settleOrderGatewayPayment } from "@/lib/services/payments";

/**
 * GET|POST /api/payments/gateway/callback/order?paymentID=…&status=… — WS-1.1.
 *
 * Where bKash sends the customer's browser back to. NOTHING in this request is
 * believed:
 *  • `paymentID` is used only as a lookup key — the real state is re-read from
 *    the gateway with payment/status inside settleOrderGatewayPayment();
 *  • `status` is used only to SKIP the execute call on an abandoned payment,
 *    never to grant one — a forged `status=success` still has to survive the
 *    server-side status read and the to-the-paisa amount comparison.
 *
 * Deliberately UNAUTHENTICATED: a redirect back from the gateway may arrive
 * without our session cookie. That is safe precisely because no caller-supplied
 * identity, amount or outcome is trusted anywhere in the settlement path.
 *
 * It never throws — the customer must always land on a page, so every failure
 * degrades to a redirect carrying an outcome flag.
 */
async function complete(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("paymentID") ?? url.searchParams.get("payment_id") ?? "";
  const callbackStatus = (url.searchParams.get("status") ?? "").toLowerCase();
  try {
    const { orderId, outcome } = await settleOrderGatewayPayment(paymentId, {
      execute: callbackStatus === "" || callbackStatus === "success",
    });
    const target = orderId ? `/customer/orders/${orderId}?payment=${outcome}` : `/customer/orders?payment=${outcome}`;
    return NextResponse.redirect(new URL(target, req.url));
  } catch (err) {
    console.error("[payments:gateway] order callback failed:", err);
    return NextResponse.redirect(new URL("/customer/orders?payment=error", req.url));
  }
}

export const GET = complete;
export const POST = complete;
