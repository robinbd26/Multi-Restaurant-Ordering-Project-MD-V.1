// Server-side enum values + display labels — ported from the previous backend
// enum choices so API responses match the previous API output exactly.
import { PAYMENT_LABELS } from "@/lib/constants";
import type { OrderStatus, PaymentMethod, Role, UserStatus } from "@/types";

export const ROLES: Role[] = [
  "super_admin",
  "management",
  "marketing",
  "branch_manager",
  "accounts",
  "rider",
  "customer",
];

export const USER_STATUSES: UserStatus[] = ["pending", "approved", "rejected"];

/**
 * Values accepted by the admin user-list `?status=` filter. The first three
 * filter the approval `status` column; `active`/`inactive` filter `isActive`
 * and `blocked` filters `isBlocked`. Unknown values are ignored.
 */
export const USER_LIST_STATUS_FILTERS = [
  "pending",
  "approved",
  "rejected",
  "active",
  "inactive",
  "blocked",
] as const;


// English role labels.
const ROLE_DISPLAY: Record<Role, string> = {
  super_admin: "Super Admin",
  management: "Management",
  marketing: "Marketing",
  branch_manager: "Branch Manager",
  accounts: "Accounts",
  rider: "Rider",
  customer: "Customer",
};

const STATUS_DISPLAY: Record<UserStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

// Bengali labels — matched to the order-status/payment choices.
const ORDER_STATUS_DISPLAY: Record<OrderStatus, string> = {
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

// WS-1.4 — one catalogue, one label set: the payment labels are derived from
// PAYMENT_METHOD_DEFS rather than restated here, so a new rail can never end up
// rendering its raw value ("nagad") in one place and its name in another.
const PAYMENT_DISPLAY: Record<PaymentMethod, string> = PAYMENT_LABELS;

// ── Complaints ────────────────────────────────────────────────────────
export const COMPLAINT_STATUSES = ["pending", "in_progress", "resolved", "closed"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_CATEGORIES = [
  "food_quality",
  "delivery",
  "service",
  "payment",
  "app",
  // A customer cannot address the rider directly any more (the recipient is
  // always the branch manager), so the manager needs to see the topic.
  "rider_behavior",
  "other",
] as const;
type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

// Roles a complaint may be addressed to (PDF: BM, Super Admin, Accounts, Management, Marketing).
export const COMPLAINT_RECIPIENTS: Role[] = [
  "branch_manager",
  "super_admin",
  "accounts",
  "management",
  "marketing",
];

const COMPLAINT_STATUS_DISPLAY: Record<ComplaintStatus, string> = {
  pending: "অপেক্ষমাণ",
  in_progress: "চলমান",
  resolved: "সমাধান হয়েছে",
  closed: "বন্ধ",
};

const COMPLAINT_CATEGORY_DISPLAY: Record<ComplaintCategory, string> = {
  food_quality: "খাবারের মান",
  delivery: "ডেলিভারি",
  service: "সেবা",
  payment: "পেমেন্ট",
  app: "অ্যাপ",
  rider_behavior: "রাইডারের আচরণ",
  other: "অন্যান্য",
};

export function complaintStatusDisplay(s: string): string {
  return COMPLAINT_STATUS_DISPLAY[s as ComplaintStatus] ?? s;
}
export function complaintCategoryDisplay(c: string): string {
  return COMPLAINT_CATEGORY_DISPLAY[c as ComplaintCategory] ?? c;
}

// ── Rider withdrawals ─────────────────────────────────────────────────
export const WITHDRAWAL_STATUSES = ["pending", "approved", "rejected", "paid"] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

const WITHDRAWAL_STATUS_DISPLAY: Record<WithdrawalStatus, string> = {
  pending: "অপেক্ষমাণ",
  approved: "অনুমোদিত",
  rejected: "প্রত্যাখ্যাত",
  paid: "পরিশোধিত",
};

export function withdrawalStatusDisplay(s: string): string {
  return WITHDRAWAL_STATUS_DISPLAY[s as WithdrawalStatus] ?? s;
}

// ── Notifications & notices ───────────────────────────────────────────
// Notification categories. `type` drives the inbox icon + optional filtering;
// system-generated notifications also carry titleKey/bodyKey for i18n.
export const NOTIFICATION_TYPES = [
  "system",
  "order",
  "delivery",
  "payment",
  "withdrawal",
  "commission",
  "complaint",
  "reward",
  "review",
  "marketing",
  "reservation",
  "ramadan",
  "notice",
  "security",
  "account",
  "branch",
  "catalog",
  // A new message in an order chat (lib/services/order-chat.ts).
  "chat",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Notice audience: "all" or a single role.
export const NOTICE_AUDIENCES = ["all", ...ROLES] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

export const NOTICE_AUDIENCE_DISPLAY: Record<string, string> = {
  all: "সবাই",
  ...ROLE_DISPLAY,
};

export type ActivityType = "login" | "logout" | "action";
export const ACTIVITY_DISPLAY: Record<ActivityType, string> = {
  login: "লগইন",
  logout: "লগআউট",
  action: "কার্যক্রম",
};

// ── Brands ────────────────────────────────────────────────────────────
// Brands are DATA (the Brand table, /admin/brands) — never a list in code. What
// lives here is only the generic rules shared by the product form and the
// server-side write checks.

/**
 * The product-form choice meaning "sold under every brand this branch serves"
 * (stored as NULL on Product.brand). Only offered on a multi-brand branch.
 */
export const ALL_BRANDS_CHOICE = "all";

// Branch venue kind — a customer-facing badge only (never an order type).
export const BRANCH_BUSINESS_TYPES = ["dine_in", "cloud_kitchen"] as const;
export type BranchBusinessType = (typeof BRANCH_BUSINESS_TYPES)[number];

export function isBranchBusinessType(v: string): v is BranchBusinessType {
  return (BRANCH_BUSINESS_TYPES as readonly string[]).includes(v);
}

/**
 * May a category tagged `categoryBrand` be used on a product whose brand is
 * `productBrand`?
 *
 * - a brand-less (NULL) category serves every brand, so it always matches;
 * - a product sold under every brand (NULL / ALL_BRANDS_CHOICE) may use any
 *   category;
 * - otherwise the slugs must be equal.
 *
 * Kept here beside the enums so the dashboard filter and the server-side write
 * check can never drift apart.
 */
export function categoryBrandMatchesProductBrand(
  categoryBrand: string | null | undefined,
  productBrand: string | null | undefined,
): boolean {
  if (!categoryBrand) return true;
  if (!productBrand || productBrand === ALL_BRANDS_CHOICE) return true;
  return categoryBrand === productBrand;
}

/**
 * req #4 — product crust/thickness policy. STABLE internal values (never the
 * translated label); display text resolves through i18n `variationType.*`.
 * THICK / THIN = the product has that single fixed crust and the server rejects
 * any other choice. BOTH = the customer must choose THICK or THIN.
 */
export const PRODUCT_VARIATION_TYPES = ["THICK", "THIN", "BOTH"] as const;
/**
 * Documented safe default for products created without an explicit choice
 * (and for the migration backfill): a single fixed crust, so no legacy product
 * suddenly demands a new mandatory customer selection.
 */
export const PRODUCT_VARIATION_TYPE_DEFAULT = "THICK";
export type ProductVariationType = (typeof PRODUCT_VARIATION_TYPES)[number];

/**
 * Phase 2 — which delivery shift a branch coverage row applies to.
 *
 * Operations runs two coverage lists per branch: a DAY list (11:00–22:45) and a
 * NIGHT list (22:45–04:00, last order 03:45), because fewer branches staff the
 * overnight shift and they cover wider ground when they do. "both" means the row
 * applies around the clock, and is the documented default so every coverage row
 * written before this existed keeps behaving exactly as it did.
 *
 * Stored as a string (SQLite has no enum), validated here. See
 * lib/services/coverage-window.ts for the clock that picks the active one.
 */
export const COVERAGE_WINDOWS = ["day", "night", "both"] as const;
export type CoverageWindow = (typeof COVERAGE_WINDOWS)[number];
export const COVERAGE_WINDOW_DEFAULT: CoverageWindow = "both";

export function isCoverageWindow(v: string): v is CoverageWindow {
  return (COVERAGE_WINDOWS as readonly string[]).includes(v);
}

export function isProductVariationType(v: string): v is ProductVariationType {
  return (PRODUCT_VARIATION_TYPES as readonly string[]).includes(v);
}

/** The crust values a customer may actually pick for a product policy. */
export function allowedCrustChoices(variationType: string): ("THICK" | "THIN")[] {
  if (variationType === "THICK") return ["THICK"];
  if (variationType === "THIN") return ["THIN"];
  if (variationType === "BOTH") return ["THICK", "THIN"];
  return [];
}

export function roleDisplay(role: string): string {
  return ROLE_DISPLAY[role as Role] ?? role;
}
export function statusDisplay(status: string): string {
  return STATUS_DISPLAY[status as UserStatus] ?? status;
}
export function orderStatusDisplay(status: string): string {
  return ORDER_STATUS_DISPLAY[status as OrderStatus] ?? status;
}
export function paymentDisplay(method: string): string {
  return PAYMENT_DISPLAY[method as PaymentMethod] ?? method;
}
