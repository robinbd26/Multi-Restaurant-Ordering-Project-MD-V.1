import { requireApproved } from "@/lib/auth/current-user";
import { forbidden, handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { trustedCustomerPoint } from "@/lib/services/customer-location";
import { nearestPickupBranch } from "@/lib/services/delivery";

// GET /api/delivery/nearest-pickup — WS-4.4.
//
// The nearest branch a customer can COLLECT from when nothing will deliver to
// them. `nearestPickupBranch` already existed and was already wired into the
// checkout coverage response; it simply had no way of being asked outside a
// cart, which is why the storefront's and the branches page's "Out of Delivery
// Zone" states could only apologise without naming anywhere to go.
//
// The point is the customer's own SERVER-side trusted coordinate (GPS fix or
// default saved address) — deliberately not a body parameter, so no caller can
// probe branch positions from arbitrary coordinates. No usable point → an empty
// answer, never a guess.
//
// Called only from the out-of-zone states, and only once they render, so the
// happy path costs nothing on a metered connection.
export const GET = handle(async () => {
  const me = await requireApproved();
  if (me.role !== "customer") throw forbidden();

  const point = await trustedCustomerPoint(me.id);
  if (!point) return json({ pickup: null });

  return json({ pickup: await nearestPickupBranch(point) });
});
