// Order lifecycle rules — ported from apps/orders/constants.py
import type { OrderStatus } from "@/types";

/**
 * Valid forward transitions of the order lifecycle.
 *
 * WS-5.1/5.2 — the graph covers every status the roles spec names: the branch
 * manager's seven (Received/Cooking/Ready for Delivery/Rider Received the Food/
 * On the Way/Complete/Cancel) and the rider's six (the same delivery leg plus
 * Delayed and Cancelled). Three rules hold throughout:
 *   • nothing moves BACKWARDS along the happy path;
 *   • `cancelled` is reachable from every OPEN state — a manager has to be able
 *     to close out an order a rider abandoned mid-delivery — always needs a
 *     reason (enforced in updateOrderStatus), and is terminal;
 *   • `delayed` is the one non-terminal detour: a delayed delivery goes back to
 *     `on_the_way` or completes as `delivered`, it never dead-ends.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: ["on_the_way", "delayed", "cancelled"],
  on_the_way: ["delayed", "delivered", "cancelled"],
  delayed: ["on_the_way", "delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

// Which statuses each role is allowed to *set*.
// The branch manager owns the WHOLE lifecycle of their branch's orders — all
// seven statuses the roles spec names for them — so an order whose rider went
// dark can still be driven to delivered or cancelled from the dashboard.
export const BRANCH_MANAGER_SETTABLE: OrderStatus[] = [
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "on_the_way",
  "delivered",
  "cancelled",
];
// The rider drives the delivery leg and may additionally flag a DELAY or hand
// the order back with a CANCEL (both of which require a reason / extra minutes).
export const RIDER_SETTABLE: OrderStatus[] = [
  "picked_up",
  "on_the_way",
  "delivered",
  "delayed",
  "cancelled",
];
export const CUSTOMER_SETTABLE: OrderStatus[] = ["cancelled"];

/**
 * WS-5.2 — bounds for the extra delivery time a rider announces with `delayed`.
 * Anything outside this window is a typo or an abuse of the field, not a real
 * delivery estimate, and is refused server-side.
 */
export const DELAY_MIN_MINUTES = 5;
export const DELAY_MAX_MINUTES = 240;

/** Quick-pick extra-time options offered in the rider UI (minutes). */
export const DELAY_MINUTE_OPTIONS = [10, 15, 20, 30, 45, 60] as const;
