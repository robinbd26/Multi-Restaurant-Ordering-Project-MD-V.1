// Order lifecycle rules — ported from apps/orders/constants.py
import type { OrderStatus } from "@/types";

export type Fulfillment = "delivery" | "pickup";

/**
 * THE order status flow (brands / hours / statuses round, Part 3).
 *
 * DELIVERY  Pending → Accepted → Preparing → Ready for rider   (branch manager)
 *           → Picked up → On the way → Delivered               (assigned RIDER only)
 * PICKUP    Pending → Accepted → Preparing → Ready for collection → Collected
 *           (all branch manager; "Collected" is stored as `delivered`, the one
 *           terminal "completed" value every report already counts, and is
 *           LABELLED Collected for pickup orders — see orderStatusLabelKey)
 *
 * Why the rider leg has ONE writer: the branch manager used to be able to set
 * picked_up / on_the_way / delivered too, and neither screen refreshed live, so
 * a manager tapping "Mark On the way" on a stale page after the rider had
 * already done it hit "Cannot move from On the Way to this status". Emergencies
 * (a rider whose phone died) go through the explicit, logged OVERRIDE instead.
 *
 * Rules that hold throughout:
 *   • nothing moves backwards in the normal flow;
 *   • `cancelled` is reachable from every open state for the branch manager
 *     (reason required) and for the rider during their leg, unchanged from before;
 *   • repeating the CURRENT status is a no-op, never an error (double tap, or a
 *     page that has not refreshed yet);
 *   • the rider may tap Picked up before the manager marked Ready — it counts
 *     as ready — and may go Picked up → Delivered without On the way;
 *   • `delayed` is no longer a status: a rider announces a delay as an event on
 *     the order and the status stays where it is.
 */
export const MANAGER_TRANSITIONS: Record<Fulfillment, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  delivery: {
    pending: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["cancelled"],
    picked_up: ["cancelled"],
    on_the_way: ["cancelled"],
  },
  pickup: {
    pending: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["delivered", "cancelled"],
  },
};

/** The assigned rider's moves (delivery orders only). */
export const RIDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  accepted: ["picked_up"],
  preparing: ["picked_up"],
  ready: ["picked_up"],
  picked_up: ["on_the_way", "delivered", "cancelled"],
  on_the_way: ["delivered", "cancelled"],
};

/** Statuses only the assigned rider sets in the normal flow. */
export const RIDER_ONLY_STATUSES: readonly OrderStatus[] = ["picked_up", "on_the_way", "delivered"];

/** Statuses an order can be in while still open (not delivered / cancelled). */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "on_the_way",
];
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["delivered", "cancelled"];

/** Every status a CURRENT order can hold, in flow order (legacy "delayed" excluded). */
export const ORDER_FLOW_STATUSES: readonly OrderStatus[] = [...OPEN_ORDER_STATUSES, "delivered", "cancelled"];

/** The statuses of one channel's flow, in order (timelines and the override). */
export function flowFor(fulfillment: Fulfillment): OrderStatus[] {
  return fulfillment === "pickup"
    ? ["pending", "accepted", "preparing", "ready", "delivered"]
    : ["pending", "accepted", "preparing", "ready", "picked_up", "on_the_way", "delivered"];
}

/**
 * Where the OVERRIDE may move an open order (branch manager / super admin, with
 * a written reason, logged): any other status of its own channel's flow except
 * back to Pending, or Cancelled. A delivered or cancelled order is final.
 */
export function overrideTargets(status: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(status)) return [];
  return [...flowFor(fulfillment).filter((s) => s !== status && s !== "pending"), "cancelled"];
}

/** The buttons a branch manager / super admin sees (the server re-checks). */
export function managerNextStatuses(status: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  return MANAGER_TRANSITIONS[fulfillment][status] ?? [];
}

/**
 * The buttons the assigned rider sees: their leg of a delivery order, plus the
 * delay announcement ("delayed", not a status) while the food is with them.
 */
export function riderNextStatuses(status: OrderStatus, fulfillment: Fulfillment = "delivery"): OrderStatus[] {
  if (fulfillment === "pickup") return [];
  const next = [...(RIDER_TRANSITIONS[status] ?? [])];
  if (status === "picked_up" || status === "on_the_way") next.push("delayed");
  return next;
}

/** Minimum length of a written override reason. */
export const OVERRIDE_REASON_MIN = 5;

/**
 * i18n key for a status label, by channel: a pickup order's `ready` reads
 * "Ready for collection" and its `delivered` "Collected"; a delivery order's
 * `ready` reads "Ready for rider". Everything else uses orderStatus.<status>.
 */
export function orderStatusLabelKey(status: string, fulfillment?: string | null): string {
  if (fulfillment === "pickup" && (status === "ready" || status === "delivered")) return `orderStatusPickup.${status}`;
  if (fulfillment !== "pickup" && status === "ready") return "orderStatusDelivery.ready";
  return `orderStatus.${status}`;
}

export const CUSTOMER_SETTABLE: OrderStatus[] = ["cancelled"];

/**
 * WS-5.2 — bounds for the extra delivery time a rider announces with `delayed`.
 * Anything outside this window is a typo or an abuse of the field, not a real
 * delivery estimate, and is refused server-side.
 */
export const DELAY_MIN_MINUTES = 5;
export const DELAY_MAX_MINUTES = 240;

/** Self Pickup — a requested pickup time must be at least this far out from
    the server's clock, so the branch always has time to prepare the order. */
export const PICKUP_MIN_LEAD_MINUTES = 30;

/** Quick-pick extra-time options offered in the rider UI (minutes). */
export const DELAY_MINUTE_OPTIONS = [10, 15, 20, 30, 45, 60] as const;
