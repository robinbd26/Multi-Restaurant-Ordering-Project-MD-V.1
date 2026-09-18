import "server-only";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/utils";

/** Well-known SystemSetting keys. */
export const SETTING_KEYS = {
  riderCommissionPerDelivery: "rider_commission_per_delivery",
  // req #3 — single global company logo (upload storage key), super-admin only.
  companyLogo: "company_logo",
  // WS-2.3 — the statutory VAT/tax rate and the house service charge, as
  // PERCENTAGES of the food slice of an order. Both default to 0 so an
  // unconfigured install reports "no tax, no service charge" rather than
  // inventing a deduction nobody authorised.
  taxRatePercent: "tax_rate_percent",
  serviceChargePercent: "service_charge_percent",
  // PHASE 4 — a flat platform fee (Tk) added to EVERY order, delivery and pickup
  // alike. Global and super-admin owned, with an optional per-branch override.
  platformFee: "platform_fee",
} as const;

/** Default per-delivery rider commission (Tk) until the super admin sets one. */
export const DEFAULT_RIDER_COMMISSION = "50.00";

/** PHASE 4 — the platform fee until the super admin sets another (Tk per order). */
export const DEFAULT_PLATFORM_FEE = "5.00";

/** A platform fee above this is a typo, not a fee; it is refused at the edge. */
export const MAX_PLATFORM_FEE = 1000;

/** Tax / service charge default to nil until finance configures a real rate. */
export const DEFAULT_TAX_RATE_PERCENT = "0.00";
export const DEFAULT_SERVICE_CHARGE_PERCENT = "0.00";

/**
 * Upper bound for either percentage. A rate above this is a typo (someone typed
 * paisa into a percent box), and a report built on it would be nonsense, so it
 * is refused at the edge instead of being stored and quietly reported.
 */
export const MAX_CHARGE_PERCENT = 100;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, updatedById?: number) {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value, updatedById: updatedById ?? null },
    create: { key, value, updatedById: updatedById ?? null },
  });
}

/**
 * Parse a stored setting into a NON-NEGATIVE Decimal, falling back to `fallback`
 * for anything missing, malformed, negative or out of range. Money and rates are
 * read on every order and every report, so a corrupt row must degrade to the
 * documented default rather than throw halfway through a close.
 */
function decimalSetting(raw: string | null, fallback: string, max?: number): Prisma.Decimal {
  if (raw === null || raw.trim() === "") return new Prisma.Decimal(fallback);
  let value: Prisma.Decimal;
  try {
    value = new Prisma.Decimal(raw);
  } catch {
    return new Prisma.Decimal(fallback);
  }
  if (!value.isFinite() || value.isNegative()) return new Prisma.Decimal(fallback);
  if (max !== undefined && value.greaterThan(max)) return new Prisma.Decimal(fallback);
  return value;
}

/**
 * WS-2.8 — per-branch commission override key.
 *
 * The schema is frozen and RiderCommission has no rule table, so a branch rule
 * lives in the same key-value SystemSetting store as the global rate, under a
 * namespaced key. The GLOBAL rate stays super-admin owned; a branch override is
 * the piece Accounts is permitted to maintain, and an absent override always
 * falls back to the global rate — a branch can never end up with no rule.
 */
export function branchCommissionKey(branchId: number): string {
  return `${SETTING_KEYS.riderCommissionPerDelivery}:branch:${branchId}`;
}

/**
 * Current per-delivery commission as a Decimal.
 *
 * With a `branchId`, the branch's own rule wins and the global rate is the
 * fallback; without one (or with no override configured) the global rate is
 * returned. Callers that never knew about branch rules keep working unchanged.
 */
export async function riderCommissionRate(branchId?: number | null): Promise<Prisma.Decimal> {
  const globalRate = decimalSetting(
    await getSetting(SETTING_KEYS.riderCommissionPerDelivery),
    DEFAULT_RIDER_COMMISSION,
  );
  if (branchId == null) return globalRate;
  const override = await getSetting(branchCommissionKey(branchId));
  return override === null ? globalRate : decimalSetting(override, globalRate.toFixed(2));
}

/** One branch's commission rule: its own rate, or the inherited global one. */
export interface BranchCommissionRule {
  branchId: number;
  branchName: string;
  /** null when the branch inherits — never a copy of the global rate. */
  override: Prisma.Decimal | null;
  /** What a delivery in this branch actually pays today. */
  effective: Prisma.Decimal;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/**
 * WS-2.8 — the whole commission rule book in ONE pass: the global rate plus
 * every active branch's rule. Two queries regardless of branch count, so the
 * management screen never fans out into one lookup per branch.
 */
export async function commissionRules(): Promise<{
  defaultRate: Prisma.Decimal;
  branches: BranchCommissionRule[];
}> {
  const [branches, rows] = await Promise.all([
    prisma.branch.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.systemSetting.findMany({
      where: { key: { startsWith: `${SETTING_KEYS.riderCommissionPerDelivery}:branch:` } },
      include: { updatedBy: true },
    }),
  ]);
  const globalRate = decimalSetting(
    await getSetting(SETTING_KEYS.riderCommissionPerDelivery),
    DEFAULT_RIDER_COMMISSION,
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return {
    defaultRate: globalRate,
    branches: branches.map((b) => {
      const row = byKey.get(branchCommissionKey(b.id));
      const override = row ? decimalSetting(row.value, globalRate.toFixed(2)) : null;
      return {
        branchId: b.id,
        branchName: b.name,
        override,
        effective: override ?? globalRate,
        updatedAt: row?.updatedAt ?? null,
        updatedByName: row?.updatedBy
          ? `${row.updatedBy.firstName} ${row.updatedBy.lastName}`.trim() || row.updatedBy.username
          : null,
      };
    }),
  };
}

/**
 * WS-2.3 — the configured tax and service-charge percentages.
 *
 * READ THIS BEFORE USING THEM. The order pipeline (lib/services/orders.ts)
 * computes `totalAmount` as items + delivery − coupon − coin discount and adds
 * NOTHING on top, which is the normal Bangladeshi menu convention: the shelf
 * price is what the customer pays, VAT and service charge INCLUDED. These rates
 * are therefore extraction rates — they say what proportion of money already
 * recorded is tax and service charge — never a surcharge to add to a total.
 * Anything else would report revenue the till never saw.
 */
export interface ChargeRates {
  taxPercent: Prisma.Decimal;
  servicePercent: Prisma.Decimal;
}

export async function chargeRates(): Promise<ChargeRates> {
  const [tax, service] = await Promise.all([
    getSetting(SETTING_KEYS.taxRatePercent),
    getSetting(SETTING_KEYS.serviceChargePercent),
  ]);
  return {
    taxPercent: decimalSetting(tax, DEFAULT_TAX_RATE_PERCENT, MAX_CHARGE_PERCENT),
    servicePercent: decimalSetting(service, DEFAULT_SERVICE_CHARGE_PERCENT, MAX_CHARGE_PERCENT),
  };
}

/**
 * PHASE 4 — per-branch platform fee override key. Same namespacing as the rider
 * commission override: no schema change, and an absent override always falls
 * back to the global fee, so a branch can never end up with no fee rule.
 */
export function branchPlatformFeeKey(branchId: number): string {
  return `${SETTING_KEYS.platformFee}:branch:${branchId}`;
}

/**
 * The platform fee an order at this branch pays, as an exact Decimal.
 *
 * UNLIKE tax and service charge (which are extraction rates over prices that
 * already include them), this IS a surcharge: it is added to the order total.
 * That is why every order snapshots it into its own column — reports must be
 * able to separate it from food revenue rather than count it as sales.
 */
export async function platformFeeFor(branchId?: number | null): Promise<Prisma.Decimal> {
  const globalFee = decimalSetting(
    await getSetting(SETTING_KEYS.platformFee),
    DEFAULT_PLATFORM_FEE,
    MAX_PLATFORM_FEE,
  );
  if (branchId == null) return globalFee;
  const override = await getSetting(branchPlatformFeeKey(branchId));
  return override === null ? globalFee : decimalSetting(override, globalFee.toFixed(2), MAX_PLATFORM_FEE);
}

/** One branch platform fee rule: its own fee, or the inherited global one. */
export interface BranchPlatformFeeRule {
  branchId: number;
  branchName: string;
  /** null when the branch inherits — never a copy of the global fee. */
  override: Prisma.Decimal | null;
  effective: Prisma.Decimal;
  updatedAt: Date | null;
}

/** The global fee and every live branch rule, in two queries. */
export async function platformFeeRules(): Promise<{
  defaultFee: Prisma.Decimal;
  updatedAt: Date | null;
  branches: BranchPlatformFeeRule[];
}> {
  const [branches, rows, globalRow] = await Promise.all([
    prisma.branch.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.systemSetting.findMany({
      where: { key: { startsWith: `${SETTING_KEYS.platformFee}:branch:` } },
    }),
    prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.platformFee } }),
  ]);
  const defaultFee = decimalSetting(globalRow?.value ?? null, DEFAULT_PLATFORM_FEE, MAX_PLATFORM_FEE);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    defaultFee,
    updatedAt: globalRow?.updatedAt ?? null,
    branches: branches.map((b) => {
      const row = byKey.get(branchPlatformFeeKey(b.id));
      const override = row ? decimalSetting(row.value, defaultFee.toFixed(2), MAX_PLATFORM_FEE) : null;
      return {
        branchId: b.id,
        branchName: b.name,
        override,
        effective: override ?? defaultFee,
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  };
}

/** Remove a branch override so the branch inherits the global fee again. */
export async function clearBranchPlatformFee(branchId: number): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: branchPlatformFeeKey(branchId) } });
}

/**
 * Resolve the single global company logo (req #3) to a browser URL, or null
 * when none is configured (callers render the built-in brand mark fallback so
 * there is never a broken image). Cache-busted by the setting's updatedAt so a
 * replaced logo never shows a stale copy. The raw storage key/filesystem path
 * is never exposed — only the /api/uploads (or CDN) URL.
 */
export async function getCompanyLogoUrl(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.companyLogo } });
  if (!row?.value) return null;
  return mediaUrl(row.value, row.updatedAt ? String(row.updatedAt.getTime()) : null);
}
