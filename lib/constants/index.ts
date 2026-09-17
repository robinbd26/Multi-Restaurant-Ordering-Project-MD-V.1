import type { OrderStatus, PaymentMethod, Role, UserStatus } from "@/types";

// ── Bengali labels ────────────────────────────────────────────────────
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "সুপার অ্যাডমিন",
  management: "ম্যানেজমেন্ট",
  marketing: "মার্কেটিং",
  branch_manager: "ব্রাঞ্চ ম্যানেজার",
  accounts: "অ্যাকাউন্টস",
  rider: "রাইডার",
  customer: "কাস্টমার",
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: "অপেক্ষমাণ",
  approved: "অনুমোদিত",
  rejected: "প্রত্যাখ্যাত",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "অপেক্ষায়",
  accepted: "গৃহীত",
  preparing: "প্রস্তুত হচ্ছে",
  ready: "প্রস্তুত",
  picked_up: "পিকআপ হয়েছে",
  on_the_way: "রাস্তায়",
  delayed: "বিলম্বিত",
  delivered: "ডেলিভারি হয়েছে",
  cancelled: "বাতিল",
};

// ── Payment methods ───────────────────────────────────────────────────
/**
 * WS-1.4 — THE payment-rail catalogue. Every screen, filter, report and
 * validator reads the method set from here, so adding a rail is one entry in
 * this array plus its dictionary keys — never a dozen edited switch statements.
 *
 * `value` is the STABLE string persisted in Order.paymentMethod (SQLite has no
 * enums); it is never a translated label. `rail` is what the method means
 * operationally:
 *  • cod    — money is collected at the door; there is nothing to record or
 *             verify, and the order stays `unpaid` until the delivery workflow
 *             settles it.
 *  • wallet — a Bangladeshi MFS (bKash / Nagad / Rocket). The customer sends
 *             money to the BRANCH's own number out of band and records the
 *             TrxID; staff verify it (lib/services/payments.ts). A wallet method
 *             may ALSO have an online gateway driver — bKash does today — but
 *             the manual record-and-verify flow is what every wallet supports.
 *
 * `bnLabel` is the Bengali display string for the server-side label maps
 * (lib/constants/enums.ts), which have no dictionary access; every USER-FACING
 * render goes through `labelKey`/`hintKey` and the i18n dictionary instead.
 */
export type PaymentRail = "cod" | "wallet" | "bank";

export interface PaymentMethodDef {
  value: PaymentMethod;
  rail: PaymentRail;
  /** i18n key for the method's name (payment.*). */
  labelKey: string;
  /** i18n key for the one-line checkout hint (orders.*Hint). */
  hintKey: string;
  /** Emoji shown on the checkout card — decorative only. */
  icon: string;
  /** Bengali label for the server-side, dictionary-less display maps. */
  bnLabel: string;
}

export const PAYMENT_METHOD_DEFS: readonly PaymentMethodDef[] = [
  { value: "cash", rail: "cod", labelKey: "payment.cash", hintKey: "orders.cashHint", icon: "💵", bnLabel: "ক্যাশ অন ডেলিভারি" },
  { value: "bkash", rail: "wallet", labelKey: "payment.bkash", hintKey: "orders.bkashHint", icon: "📱", bnLabel: "বিকাশ" },
  { value: "nagad", rail: "wallet", labelKey: "payment.nagad", hintKey: "orders.nagadHint", icon: "📱", bnLabel: "নগদ" },
  { value: "rocket", rail: "wallet", labelKey: "payment.rocket", hintKey: "orders.rocketHint", icon: "📱", bnLabel: "রকেট" },
  // Manually-verified off-wallet rail: no destination number/TrxID machinery;
  // the order is placed and stays "unpaid" (pending) until the branch confirms
  // the transfer. No fake success — see the bank payment panel on the order page.
  { value: "bank", rail: "bank", labelKey: "payment.bank", hintKey: "orders.bankHint", icon: "🏦", bnLabel: "ব্যাংক ট্রান্সফার" },
] as const;

/** Every method value, in the order customers should see them. */
export const PAYMENT_METHODS: PaymentMethod[] = PAYMENT_METHOD_DEFS.map((m) => m.value);

/**
 * The methods offered to the CUSTOMER at checkout (req #8): Cash on Delivery,
 * bKash, Nagad and Bank Transfer. Rocket stays in the catalogue for history,
 * reports and invoices, but is no longer offered to new customers.
 */
export const CUSTOMER_PAYMENT_METHODS: readonly PaymentMethod[] = [
  "cash",
  "bkash",
  "nagad",
  "bank",
];

/** The MFS rails — the ones with a destination number and a TrxID to verify. */
export const WALLET_PAYMENT_METHODS: PaymentMethod[] = PAYMENT_METHOD_DEFS.filter(
  (m) => m.rail === "wallet",
).map((m) => m.value);

/** The catalogue entry for a stored value, or null when it is not a known rail. */
export function paymentMethodDef(value: string): PaymentMethodDef | null {
  return PAYMENT_METHOD_DEFS.find((m) => m.value === value) ?? null;
}

/** True when `v` is a method an order may actually be placed with. */
export function isPaymentMethod(v: string): v is PaymentMethod {
  return paymentMethodDef(v) !== null;
}

/** True when the method is an MFS wallet (manual submit + staff verification). */
export function isWalletPaymentMethod(v: string): boolean {
  return paymentMethodDef(v)?.rail === "wallet";
}

/**
 * Dictionary key for a method label. Falls back to `payment.<value>` for a
 * legacy/unknown value so an old row still renders something rather than
 * crashing a report — the same forgiving shape as `paymentDisplay`.
 */
export function paymentLabelKey(value: string): string {
  return paymentMethodDef(value)?.labelKey ?? `payment.${value}`;
}

/** Bengali labels, derived from the catalogue. Kept for existing importers. */
export const PAYMENT_LABELS: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHOD_DEFS.map((m) => [m.value, m.bnLabel]),
) as Record<PaymentMethod, string>;

// Forward transitions each role can trigger from a given status. These are the
// UI's view of ALLOWED_TRANSITIONS ∩ <role>_SETTABLE (lib/constants/orders.ts) —
// the server re-derives and re-enforces both, so a forged status still fails.
//
// WS-5.1 — the manager reaches all seven of their statuses, including the
// delivery leg, so an order whose rider abandoned it can still be completed or
// cancelled from the branch dashboard. Cancel stays available from every open
// state and always requires a reason.
export const BM_NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: ["on_the_way", "cancelled"],
  on_the_way: ["delivered", "cancelled"],
  delayed: ["on_the_way", "delivered", "cancelled"],
};

// WS-5.2 — the rider can flag a DELAY (which notifies the customer of the extra
// minutes) from either leg of the delivery, and can hand the order back with a
// cancellation. `delayed` is non-terminal: it leads back to on_the_way/delivered.
export const RIDER_NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  ready: ["picked_up"],
  picked_up: ["on_the_way", "delayed", "cancelled"],
  on_the_way: ["delivered", "delayed", "cancelled"],
  delayed: ["on_the_way", "delivered", "cancelled"],
};

// ── Role → home dashboard path ────────────────────────────────────────
export const ROLE_HOME: Record<Role, string> = {
  super_admin: "/admin/dashboard",
  management: "/management/dashboard",
  marketing: "/marketing/dashboard",
  branch_manager: "/branch-manager/dashboard",
  accounts: "/accounts/dashboard",
  rider: "/rider/dashboard",
  // A customer lands on the PUBLIC HOMEPAGE, not on a dashboard: the homepage is
  // where the ordering flow actually starts (location prompt → nearest eligible
  // branch → menu → cart → checkout), and it renders the signed-in state via
  // getOptionalUser(). /customer/dashboard and /customer/branches both still
  // exist and stay reachable from the customer navigation — they are simply no
  // longer an automatic destination. Staff roles keep their own dashboards; no
  // staff role may ever resolve to "/" (see loginDestination).
  customer: "/",
};

/**
 * The role's DASHBOARD page, which is not always the page they land on after
 * signing in. A customer lands on the public homepage (ROLE_HOME), but a link
 * labelled "Dashboard" — and any deep link that means "your account area" —
 * must still go to /customer/dashboard. Use this map for links, ROLE_HOME for
 * post-login redirects; never conflate the two.
 */
export const ROLE_DASHBOARD: Record<Role, string> = {
  super_admin: "/admin/dashboard",
  management: "/management/dashboard",
  marketing: "/marketing/dashboard",
  branch_manager: "/branch-manager/dashboard",
  accounts: "/accounts/dashboard",
  rider: "/rider/dashboard",
  customer: "/customer/dashboard",
};

// ── Role → section base path (dashboard prefix without /dashboard) ────
export const ROLE_BASE: Record<Role, string> = {
  super_admin: "/admin",
  management: "/management",
  marketing: "/marketing",
  branch_manager: "/branch-manager",
  accounts: "/accounts",
  rider: "/rider",
  customer: "/customer",
};

/** Path to a role's notifications inbox (used by the topbar bell). */
export function notificationsPath(role: Role): string {
  return `${ROLE_BASE[role]}/notifications`;
}

// ── Sidebar navigation per role ───────────────────────────────────────
/** Customer support hotline — sidebar pill + public header. */
export const SUPPORT_PHONE = "09638-050505";

export interface NavItem {
  href: string;
  /** i18n key resolved at render time (e.g. "nav.dashboard"). */
  label: string;
  icon: string; // key into the icon map in components/layout/icons.tsx
  /**
   * Sidebar section this item sits under (i18n key under `navGroup.*`).
   * Matches the mockup's .nav-group-label; items without one (Dashboard) render
   * above the first heading, exactly as in the design file.
   */
  group?: string;
}

export const ROLE_NAV: Record<Role, NavItem[]> = {
  super_admin: [
    { href: "/admin/dashboard", label: "nav.dashboard", icon: "home" },
    { href: "/admin/users", label: "nav.users", icon: "users" , group: "navGroup.people" },
    { href: "/admin/customers", label: "nav.customers", icon: "user" , group: "navGroup.people" },
    { href: "/admin/staff", label: "nav.staff", icon: "users" , group: "navGroup.people" },
    { href: "/admin/branches", label: "nav.branches", icon: "store" , group: "navGroup.catalog" },
    { href: "/admin/delivery-areas", label: "nav.deliveryAreas", icon: "bike" , group: "navGroup.catalog" },
    { href: "/admin/products", label: "nav.products", icon: "grid" , group: "navGroup.catalog" },
    { href: "/admin/categories", label: "nav.categories", icon: "list" , group: "navGroup.catalog" },
    { href: "/admin/orders", label: "nav.orders", icon: "bag" , group: "navGroup.orders" },
    { href: "/admin/reports", label: "nav.reports", icon: "chart" , group: "navGroup.insights" },
    { href: "/admin/branch-manager-history", label: "nav.managerHistory", icon: "history" , group: "navGroup.system" },
    { href: "/admin/activity-logs", label: "nav.activityLogs", icon: "list" , group: "navGroup.system" },
    { href: "/admin/rewards", label: "nav.rewards", icon: "money" , group: "navGroup.insights" },
    { href: "/admin/notices", label: "nav.notices", icon: "megaphone" , group: "navGroup.insights" },
    { href: "/admin/complaints", label: "nav.complaints", icon: "inbox" , group: "navGroup.customers" },
    { href: "/admin/notifications", label: "nav.notifications", icon: "bell" , group: "navGroup.system" },
    { href: "/admin/settings", label: "nav.settings", icon: "lock" , group: "navGroup.system" },
  ],
  management: [
    { href: "/management/dashboard", label: "nav.dashboard", icon: "home" },
    { href: "/management/branches", label: "nav.branches", icon: "store" , group: "navGroup.operations" },
    { href: "/management/orders", label: "nav.orders", icon: "bag" , group: "navGroup.operations" },
    // WS-8.3 — cross-branch inventory / product availability. The catalog pages
    // live under /admin and /branch-manager, both closed to this role by
    // ROUTE_ROLES, so Management needs its own read-only monitor.
    { href: "/management/inventory", label: "nav.inventory", icon: "grid" , group: "navGroup.operations" },
    { href: "/management/ramadan", label: "nav.ramadan", icon: "store" , group: "navGroup.operations" },
    { href: "/management/performance", label: "nav.performance", icon: "bike" , group: "navGroup.operations" },
    { href: "/management/reports", label: "nav.reports", icon: "chart" , group: "navGroup.insights" },
    { href: "/management/analytics", label: "nav.analytics", icon: "chart" , group: "navGroup.insights" },
    { href: "/management/exports", label: "nav.exports", icon: "list" , group: "navGroup.insights" },
    { href: "/management/complaints", label: "nav.complaints", icon: "inbox" , group: "navGroup.system" },
    { href: "/management/notifications", label: "nav.notifications", icon: "bell" , group: "navGroup.system" },
  ],
  marketing: [
    { href: "/marketing/dashboard", label: "nav.dashboard", icon: "home" },
    { href: "/marketing/customers", label: "nav.customers", icon: "users" , group: "navGroup.customers" },
    { href: "/marketing/products", label: "nav.products", icon: "grid" , group: "navGroup.catalog" },
    { href: "/marketing/campaigns", label: "nav.campaigns", icon: "bag" , group: "navGroup.marketing" },
    { href: "/marketing/coupons", label: "nav.coupons", icon: "money" , group: "navGroup.marketing" },
    { href: "/marketing/audience", label: "nav.audience", icon: "users" , group: "navGroup.customers" },
    { href: "/marketing/performance", label: "nav.performance", icon: "chart" , group: "navGroup.insights" },
    { href: "/marketing/feedback", label: "nav.feedback", icon: "check" , group: "navGroup.insights" },
    { href: "/marketing/complaints", label: "nav.complaints", icon: "inbox" , group: "navGroup.system" },
    { href: "/marketing/notifications", label: "nav.notifications", icon: "bell" , group: "navGroup.system" },
    { href: "/marketing/reports", label: "nav.reports", icon: "chart" , group: "navGroup.insights" },
  ],
  accounts: [
    { href: "/accounts/dashboard", label: "nav.dashboard", icon: "home" },
    { href: "/accounts/sales", label: "nav.sales", icon: "money" , group: "navGroup.finance" },
    { href: "/accounts/payments", label: "nav.payments", icon: "money" , group: "navGroup.finance" },
    { href: "/accounts/transactions", label: "nav.transactions", icon: "list" , group: "navGroup.finance" },
    { href: "/accounts/ramadan", label: "nav.ramadan", icon: "store" , group: "navGroup.finance" },
    { href: "/accounts/withdrawals", label: "nav.withdrawals", icon: "money" , group: "navGroup.finance" },
    { href: "/accounts/rider-earnings", label: "nav.riderEarnings", icon: "bike" , group: "navGroup.finance" },
    // WS-2.8 — individual commission records + the branch rule book.
    { href: "/accounts/commissions", label: "nav.commissions", icon: "bike" , group: "navGroup.finance" },
    { href: "/accounts/refunds", label: "nav.refunds", icon: "money" , group: "navGroup.finance" },
    { href: "/accounts/invoices", label: "nav.invoices", icon: "list" , group: "navGroup.finance" },
    { href: "/accounts/expenses", label: "nav.expenses", icon: "money" , group: "navGroup.finance" },
    { href: "/accounts/settlements", label: "nav.settlements", icon: "check" , group: "navGroup.finance" },
    { href: "/accounts/adjustments", label: "nav.adjustments", icon: "grid" , group: "navGroup.finance" },
    { href: "/accounts/audit-log", label: "nav.auditLog", icon: "history" , group: "navGroup.insights" },
    // WS-2.3 — tax, service charge, discounts, coupon cost and promotional spend.
    { href: "/accounts/deductions", label: "nav.deductions", icon: "chart" , group: "navGroup.insights" },
    { href: "/accounts/orders", label: "nav.orders", icon: "bag" , group: "navGroup.orders" },
    { href: "/accounts/complaints", label: "nav.complaints", icon: "inbox" , group: "navGroup.system" },
    { href: "/accounts/notifications", label: "nav.notifications", icon: "bell" , group: "navGroup.system" },
    { href: "/accounts/reports", label: "nav.reports", icon: "chart" , group: "navGroup.insights" },
  ],
  branch_manager: [
    { href: "/branch-manager/dashboard", label: "nav.dashboard", icon: "home" },
    { href: "/branch-manager/catalog", label: "nav.catalog", icon: "grid" , group: "navGroup.catalog" },
    { href: "/branch-manager/orders", label: "nav.orders", icon: "bag" , group: "navGroup.orders" },
    { href: "/branch-manager/riders", label: "nav.riders", icon: "bike" , group: "navGroup.delivery" },
    { href: "/branch-manager/delivery-zone", label: "nav.deliveryZone", icon: "pin" , group: "navGroup.delivery" },
    { href: "/branch-manager/tables", label: "nav.tables", icon: "grid" , group: "navGroup.delivery" },
    { href: "/branch-manager/table-reservations", label: "nav.reservations", icon: "grid" , group: "navGroup.delivery" },
    { href: "/branch-manager/ramadan-bookings", label: "nav.ramadan", icon: "store" , group: "navGroup.delivery" },
    { href: "/branch-manager/employees", label: "nav.employees", icon: "check" , group: "navGroup.staff" },
    { href: "/branch-manager/attendance", label: "nav.attendance", icon: "check" , group: "navGroup.staff" },
    { href: "/branch-manager/reports", label: "nav.reports", icon: "chart" , group: "navGroup.insights" },
    { href: "/branch-manager/complaints", label: "nav.complaints", icon: "inbox" , group: "navGroup.customers" },
    { href: "/branch-manager/notifications", label: "nav.notifications", icon: "bell" , group: "navGroup.system" },
    { href: "/branch-manager/duty-history", label: "nav.dutyHistory", icon: "history" , group: "navGroup.staff" },
  ],
  rider: [
    { href: "/rider/dashboard", label: "nav.dashboard", icon: "home" },
    { href: "/rider/new-orders", label: "nav.newOrders", icon: "bag" , group: "navGroup.orders" },
    { href: "/rider/deliveries", label: "nav.deliveries", icon: "bike" , group: "navGroup.orders" },
    { href: "/rider/order-history", label: "nav.orderHistory", icon: "history" , group: "navGroup.orders" },
    { href: "/rider/earnings", label: "nav.earnings", icon: "money" , group: "navGroup.earnings" },
    { href: "/rider/wallet", label: "nav.wallet", icon: "cart" , group: "navGroup.earnings" },
    { href: "/rider/withdrawals", label: "nav.withdrawals", icon: "money" , group: "navGroup.earnings" },
    { href: "/rider/performance", label: "nav.performance", icon: "chart" , group: "navGroup.insights" },
    { href: "/rider/location-history", label: "nav.locationHistory", icon: "pin" , group: "navGroup.activity" },
    { href: "/rider/route-history", label: "nav.routeHistory", icon: "history" , group: "navGroup.activity" },
    { href: "/rider/login-history", label: "nav.loginHistory", icon: "lock" , group: "navGroup.activity" },
    { href: "/rider/vehicle", label: "nav.vehicle", icon: "grid" , group: "navGroup.system" },
    { href: "/rider/duty-history", label: "nav.dutyHistory", icon: "clock" , group: "navGroup.activity" },
    { href: "/rider/attendance", label: "nav.attendance", icon: "check" , group: "navGroup.activity" },
    { href: "/rider/complaints", label: "nav.complaints", icon: "inbox" , group: "navGroup.system" },
    { href: "/rider/notifications", label: "nav.notifications", icon: "bell" , group: "navGroup.system" },
    { href: "/rider/support", label: "nav.support", icon: "phone" , group: "navGroup.system" },
  ],
  customer: [
    { href: "/customer/dashboard", label: "nav.dashboard", icon: "home" },
    { href: "/customer/branches", label: "nav.restaurants", icon: "store" , group: "navGroup.orders" },
    { href: "/customer/cart", label: "nav.cart", icon: "cart" , group: "navGroup.orders" },
    { href: "/customer/orders", label: "nav.myOrders", icon: "bag" , group: "navGroup.orders" },
    { href: "/customer/addresses", label: "nav.addresses", icon: "pin" , group: "navGroup.account" },
    { href: "/customer/rewards", label: "nav.rewards", icon: "money" , group: "navGroup.account" },
    { href: "/customer/reviews", label: "nav.reviews", icon: "check" , group: "navGroup.account" },
    { href: "/customer/reservations", label: "nav.reservations", icon: "grid" , group: "navGroup.delivery" },
    { href: "/customer/ramadan-bookings", label: "nav.ramadan", icon: "store" , group: "navGroup.delivery" },
    { href: "/customer/complaints", label: "nav.complaints", icon: "inbox" , group: "navGroup.system" },
    { href: "/customer/notifications", label: "nav.notifications", icon: "bell" , group: "navGroup.system" },
    { href: "/customer/support", label: "nav.support", icon: "phone" , group: "navGroup.system" },
    { href: "/customer/settings", label: "nav.settings", icon: "lock" , group: "navGroup.system" },
  ],
};

// Route-prefix → roles allowed (used by the proxy for lightweight checks).
// super_admin bypasses these gates (see proxy.ts). Backend re-enforces all.
export const ROUTE_ROLES: [string, Role[]][] = [
  ["/admin", ["super_admin"]],
  ["/management", ["management"]],
  ["/marketing", ["marketing"]],
  ["/accounts", ["accounts"]],
  ["/branch-manager", ["branch_manager"]],
  ["/rider", ["rider"]],
  ["/customer", ["customer"]],
];
