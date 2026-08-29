import type { OrderStatus } from "@/types";

/** The rider-facing delivery lifecycle (green step tracker + timeline). */
export interface RiderStep {
  key: OrderStatus;
  /** i18n key resolved at render time (e.g. "rider.stepAssigned"). */
  label: string;
  icon: string;
}

export const RIDER_STEPS: RiderStep[] = [
  { key: "ready", label: "rider.stepAssigned", icon: "📦" },
  { key: "picked_up", label: "rider.stepPickup", icon: "🛍️" },
  { key: "on_the_way", label: "rider.stepOnTheWay", icon: "🏍️" },
  { key: "delivered", label: "rider.stepDelivered", icon: "✅" },
];

/**
 * Index into RIDER_STEPS for a given order status.
 * Anything before `ready` (pending/accepted/preparing) sits at the first step,
 * `cancelled` returns -1.
 *
 * WS-5.2 — `delayed` is NOT a step of its own and never moves the tracker
 * backwards: the rider still has the food and is still on the way, they have
 * only told the customer it will take longer. It therefore holds at the
 * on-the-way step (the amber status badge is what communicates the delay).
 */
export function riderStepIndex(status: OrderStatus): number {
  if (status === "cancelled") return -1;
  const effective: OrderStatus = status === "delayed" ? "on_the_way" : status;
  const order: OrderStatus[] = [
    "pending",
    "accepted",
    "preparing",
    "ready",
    "picked_up",
    "on_the_way",
    "delivered",
  ];
  const rank = order.indexOf(effective);
  const readyRank = order.indexOf("ready");
  if (rank <= readyRank) return 0;
  return rank - readyRank; // ready=0, picked_up=1, on_the_way=2, delivered=3
}
