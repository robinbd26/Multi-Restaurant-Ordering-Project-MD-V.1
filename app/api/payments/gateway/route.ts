import { requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { gatewayStatusPayload } from "@/lib/services/payments";

// GET /api/payments/gateway — WS-1.1 availability probe.
//
// Tells the checkout whether an online-payment button should exist at all. With
// no BKASH_* credentials this answers { configured: false } and the UI keeps
// offering cash + manual bKash only — the repo's demo fallback, intact.
// No secret is ever returned, only the provider name.
export const GET = handle(async () => {
  await requireApproved();
  return json(gatewayStatusPayload());
});
