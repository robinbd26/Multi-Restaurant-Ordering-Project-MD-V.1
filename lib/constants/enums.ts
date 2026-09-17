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
// Branch brand coverage + product brand tags. Stored as strings (SQLite has no
// enum), validated here. Labels resolve through i18n (messages/*.json brands.*)
// — never hardcode brand display text in UI.
export const BRAND_TYPES = ["cheez", "madchef", "combined"] as const;
export type BrandType = (typeof BRAND_TYPES)[number];

export const PRODUCT_BRANDS = ["cheez", "madchef"] as const;
export type ProductBrand = (typeof PRODUCT_BRANDS)[number];

export function isBrandType(v: string): v is BrandType {
  return (BRAND_TYPES as readonly string[]).includes(v);
}
export function isProductBrand(v: string): v is ProductBrand {
  return (PRODUCT_BRANDS as readonly string[]).includes(v);
}

/**
 * The brand choices a PRODUCT may carry in the dashboard form.
 *
 * `cheez` / `madchef` are the real brand tags. `combined` is the explicit
 * "sold under BOTH brands" choice — a product that is listed in both storefront
 * brand tabs (see `brandsOf` in lib/services/public-catalog.ts). It is only
 * ever offered or stored on a COMBINED branch; a single-brand branch still
 * forces its own brand (see `resolveProductBrand` in lib/services/catalog.ts).
 */
export const PRODUCT_BRAND_CHOICES = ["cheez", "madchef", "combined"] as const;
export type ProductBrandChoice = (typeof PRODUCT_BRAND_CHOICES)[number];

export function isProductBrandChoice(v: string): v is ProductBrandChoice {
  return (PRODUCT_BRAND_CHOICES as readonly string[]).includes(v);
}

/**
 * A CATEGORY's brand scope. Stored on `Category.brand`; NULL means "serves both
 * brands" (the default for every pre-existing row).
 */
export function isCategoryBrand(v: string): v is ProductBrand {
  return isProductBrand(v);
}

/**
 * May a category tagged `categoryBrand` be used on a product whose brand choice
 * is `productBrand`
 *
 * - a brand-less (NULL) category serves everyone, so it always matches;
 * - a product sold under `combined` (both brands) may use any category;
 * - otherwise the tags must be equal.
 *
 * Kept here beside the enums so the dashboard filter and the server-side write
 * check can never drift apart.
 */
export function categoryBrandMatchesProductBrand(
  categoryBrand: string | null | undefined,
  productBrand: string,
): boolean {
  if (!categoryBrand) return true;
  if (productBrand === "combined") return true;
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

/** Which product brands a branch of the given brandType may carry. */
export function brandsForBranchType(brandType: string): ProductBrand[] {
  if (brandType === "cheez") return ["cheez"];
  if (brandType === "madchef") return ["madchef"];
  return ["cheez", "madchef"]; // combined
}

/** True if a product tagged `productBrand` may live in a `brandType` branch. */
export function branchAllowsBrand(brandType: string, productBrand: string): boolean {
  return (brandsForBranchType(brandType) as readonly string[]).includes(productBrand);
}

/** The implicit brand of a single-brand branch; null when combined. */
export function soleBrandOfBranch(brandType: string): ProductBrand | null {
  if (brandType === "cheez") return "cheez";
  if (brandType === "madchef") return "madchef";
  return null;
}

/** i18n key for a brand / brand-type label (brands.cheez, brands.combined …). */
export function brandLabelKey(brand: string): string {
  return `brands.${brand}`;
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
