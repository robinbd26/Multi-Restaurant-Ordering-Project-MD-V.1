import { NextResponse } from "next/server";

import { settleRamadanAdvanceFromGateway } from "@/lib/services/ramadan";

/**
 * GET|POST /api/payments/gateway/callback/ramadan?paymentID=…&status=… — WS-1.3.
 *
 * The Ramadan-advance twin of the order callback, and it follows exactly the
 * same rule: the request is a lookup key plus a hint, never a verdict. The
 * booking is settled only after payment/status is read back from the gateway
 * and the amount matches the required advance to the paisa.
 *
 * Unauthenticated on purpose (a gateway redirect may not carry our cookie) and
 * safe because no caller-supplied outcome or amount is trusted. It never throws.
 */
async function complete(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("paymentID") ?? url.searchParams.get("payment_id") ?? "";
  const callbackStatus = (url.searchParams.get("status") ?? "").toLowerCase();
  try {
    const { reservationId, outcome } = await settleRamadanAdvanceFromGateway(paymentId, {
      // Only ever used to skip work on an abandoned payment, never to grant one.
      execute: callbackStatus === "" || callbackStatus === "success",
    });
    const target = reservationId
      ? `/customer/ramadan-bookings/${reservationId}?payment=${outcome}`
      : `/customer/ramadan-bookings?payment=${outcome}`;
    return NextResponse.redirect(new URL(target, req.url));
  } catch (err) {
    console.error("[ramadan:gateway] advance callback failed:", err);
    return NextResponse.redirect(new URL("/customer/ramadan-bookings?payment=error", req.url));
  }
}

export const GET = complete;
export const POST = complete;
