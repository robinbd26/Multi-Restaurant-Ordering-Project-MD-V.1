/**
 * Order chat and contact rules that need no database — who may read or post in
 * an order's chat, when the chat goes read-only, and when the customer and the
 * rider may see each other's phone numbers.
 *
 * Pure and CLIENT-SAFE on purpose (no prisma, no "server-only"): the server
 * service (lib/services/order-chat.ts), the order serializer and the unit tests
 * (tests/order-chat-policy.test.mts) all read these, so the rule is written
 * once. Every input is a plain fact already loaded by the caller.
 * See docs/order-chat-plan.md.
 */

/** The chat stays writable this long after the order is delivered or cancelled. */
export const CHAT_READ_ONLY_AFTER_MS = 2 * 60 * 60 * 1000;

export const TERMINAL_ORDER_STATUSES: readonly string[] = ["delivered", "cancelled"];

/**
 * Statuses in which a delivery is still in flight. Mirrors OPEN_DELIVERY_STATES
 * (lib/services/rider-duty.ts) and IN_FLIGHT_DELIVERY_STATES
 * (lib/services/rider-location.ts), so "the rider is still carrying my food"
 * means the same thing for going offline, live tracking and phone numbers.
 */
export const IN_FLIGHT_DELIVERY_STATUSES: readonly string[] = [
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "on_the_way",
  "delayed",
];

/** One-tap replies for riders. Stored as the key, rendered in the reader's language. */
export const RIDER_QUICK_REPLIES = [
  "arrived",
  "cant_find_address",
  "on_my_way",
  "running_late",
  "come_to_gate",
] as const;
export type RiderQuickReply = (typeof RIDER_QUICK_REPLIES)[number];

export function isRiderQuickReply(value: unknown): value is RiderQuickReply {
  return typeof value === "string" && (RIDER_QUICK_REPLIES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

// ── Who is in the chat ──────────────────────────────────────────────────

/** A participant's role in the chat (also the message badge). */
export type ChatRole = "customer" | "branch_manager" | "rider";

/** Participants read and write; the super admin only observes. */
export type ChatAccess =
  | { role: ChatRole; canWrite: true }
  | { role: "observer"; canWrite: false };

export interface ChatViewer {
  id: number;
  role: string;
}

export interface ChatOrderFacts {
  customerId: number;
  riderId: number | null;
  fulfillmentType: string;
  /** `order.branch.managerId` — the one login that represents the branch. */
  branchManagerId: number | null;
}

/**
 * The viewer's place in an order's chat, or null for no access at all.
 *
 * Derived from the order, never from a stored member list: the rider is whoever
 * `order.riderId` names right now, so a replaced rider loses access the moment
 * the order moves on, and a pickup order never has one.
 */
export function chatAccessFor(viewer: ChatViewer, order: ChatOrderFacts): ChatAccess | null {
  if (viewer.id === order.customerId) return { role: "customer", canWrite: true };
  if (viewer.role === "branch_manager" && order.branchManagerId === viewer.id) {
    return { role: "branch_manager", canWrite: true };
  }
  if (viewer.role === "rider" && order.fulfillmentType === "delivery" && order.riderId === viewer.id) {
    return { role: "rider", canWrite: true };
  }
  if (viewer.role === "super_admin") return { role: "observer", canWrite: false };
  return null;
}

// ── When the chat closes ────────────────────────────────────────────────

/** The instant the chat becomes read-only, or null while the order is open. */
export function chatReadOnlyAt(endedAt: Date | null): Date | null {
  return endedAt ? new Date(endedAt.getTime() + CHAT_READ_ONLY_AFTER_MS) : null;
}

export function isChatReadOnly(endedAt: Date | null, now: Date = new Date()): boolean {
  const at = chatReadOnlyAt(endedAt);
  return at !== null && now.getTime() >= at.getTime();
}

// ── Phone numbers ───────────────────────────────────────────────────────

export interface DeliveryContactFacts {
  fulfillmentType: string;
  status: string;
  riderId: number | null;
  /** The order's most recent assignment offer (any rider), or null. */
  latestAssignment: { riderId: number; status: string } | null;
}

/**
 * True while the customer and the rider may see each other's real numbers: a
 * delivery order, in flight, whose CURRENT rider has ACCEPTED the offer. A
 * pending offer is not an active delivery (the rider may still reject it), and
 * once the order is delivered or cancelled the numbers are hidden again.
 */
export function deliveryContactActive(o: DeliveryContactFacts): boolean {
  if (o.fulfillmentType !== "delivery" || o.riderId == null) return false;
  if (!IN_FLIGHT_DELIVERY_STATUSES.includes(o.status)) return false;
  const a = o.latestAssignment;
  return a !== null && a.riderId === o.riderId && a.status === "accepted";
}

export interface PhoneVisibility {
  /** The customer's number (and their bKash payer number). */
  customerPhone: boolean;
  /** The assigned rider's number. */
  riderPhone: boolean;
  /** The number the customer paid bKash from. */
  payerPhone: boolean;
}

const ALL_VISIBLE: PhoneVisibility = { customerPhone: true, riderPhone: true, payerPhone: true };

/**
 * Which phone numbers on an order `viewer` may receive from the API.
 *
 * Only the customer↔rider pair is restricted: a customer sees the rider's
 * number, and a rider the customer's, only during an active delivery
 * (`deliveryContactActive`). A rider never needs the bKash payer number. Branch
 * managers and back-office roles keep what they had; the order routes already
 * scope which orders they can see at all.
 */
export function orderPhoneVisibility(
  viewer: ChatViewer,
  order: DeliveryContactFacts & { customerId: number },
): PhoneVisibility {
  if (viewer.role === "customer") {
    return { customerPhone: true, riderPhone: deliveryContactActive(order), payerPhone: true };
  }
  if (viewer.role === "rider") {
    const own = order.riderId === viewer.id;
    return { customerPhone: own && deliveryContactActive(order), riderPhone: own, payerPhone: false };
  }
  return ALL_VISIBLE;
}
