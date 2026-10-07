import "server-only";

import { cache } from "react";
import type { Brand, Prisma, User } from "@prisma/client";

import { revalidateCatalog } from "@/lib/cache/catalog";
import { prisma } from "@/lib/db";
import { conflict, forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { deleteUpload, saveUpload } from "@/lib/http/upload";
import { logAdminAction } from "@/lib/services/audit";
import {
  accentForeground,
  BRAND_COLOR_PATTERN,
  BRAND_SLUG_PATTERN,
  type BrandInfo,
} from "@/lib/brands/shared";
import { mediaUrl } from "@/lib/utils";

/**
 * Brands as data. The super admin creates, edits, reorders, activates,
 * deactivates and archives brands at /admin/brands; every storefront and
 * dashboard surface reads them from here, so a new brand needs no code change.
 *
 * REMOVAL follows the rule every admin list already uses: anything with history
 * is ARCHIVED, only pure setup data is DELETED. A brand with products,
 * categories or order lines can only be archived; an unused one may be deleted.
 *
 * Every change is written to Activity Logs.
 */

export function serializeBrand(b: Brand): BrandInfo {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    name_bn: b.nameBn,
    logo: mediaUrl(b.logo, b.updatedAt.toISOString()),
    accent_color: b.accentColor,
    accent_foreground: accentForeground(b.accentColor),
    description: b.description,
    description_bn: b.descriptionBn,
    tagline: b.tagline,
    tagline_bn: b.taglineBn,
    emoji: b.emoji,
    show_crust_guide: b.showCrustGuide,
    sort_order: b.sortOrder,
    is_active: b.isActive,
    is_archived: b.isArchived,
  };
}

const BRAND_ORDER: Prisma.BrandOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { id: "asc" }];

/** Brands customers may see: active and not archived, in display order. */
export async function activeBrands(): Promise<BrandInfo[]> {
  const rows = await prisma.brand.findMany({ where: { isActive: true, isArchived: false }, orderBy: BRAND_ORDER });
  return rows.map(serializeBrand);
}

/**
 * Brands a staff form may offer (active or inactive, never archived). An
 * inactive brand can still be assigned to a branch or product: deactivating is
 * "hide from customers for now", not "stop managing".
 */
export async function assignableBrands(): Promise<BrandInfo[]> {
  const rows = await prisma.brand.findMany({ where: { isArchived: false }, orderBy: BRAND_ORDER });
  return rows.map(serializeBrand);
}

/** Every brand including archived ones (admin list, labels for old data). */
export async function allBrands(): Promise<BrandInfo[]> {
  const rows = await prisma.brand.findMany({ orderBy: [{ isArchived: "asc" }, ...BRAND_ORDER] });
  return rows.map(serializeBrand);
}

/**
 * Every brand, memoised for the current request: pages render several brand
 * badges and selects, and each would otherwise re-read the same small table.
 */
export const brandsForRequest = cache(allBrands);

/** Slugs a branch serves, in brand display order. Includes inactive brands. */
export async function branchBrandSlugs(branchId: number): Promise<string[]> {
  const rows = await prisma.branchBrand.findMany({
    where: { branchId, brand: { isArchived: false } },
    include: { brand: { select: { slug: true, sortOrder: true, id: true } } },
  });
  return rows
    .sort((a, b) => a.brand.sortOrder - b.brand.sortOrder || a.brand.id - b.brand.id)
    .map((r) => r.brand.slug);
}

/** Brands a branch serves that customers may order from (active, unarchived). */
export async function customerBrandsForBranch(branchId: number): Promise<BrandInfo[]> {
  const rows = await prisma.branchBrand.findMany({
    where: { branchId, brand: { isActive: true, isArchived: false } },
    include: { brand: true },
  });
  return rows
    .map((r) => r.brand)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map(serializeBrand);
}

// ── Validation ───────────────────────────────────────────────────────────

export interface BrandInput {
  slug?: string;
  name?: string;
  name_bn?: string;
  accent_color?: string;
  description?: string;
  description_bn?: string;
  tagline?: string;
  tagline_bn?: string;
  emoji?: string;
  show_crust_guide?: string | boolean;
  sort_order?: string | number;
  is_active?: string | boolean;
}

const LIMITS = { name: 60, description: 200, tagline: 40, emoji: 8 } as const;

function bool(v: string | boolean | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "on" || v === "1";
}

function text(v: string | undefined, max: number): string | undefined {
  if (v === undefined) return undefined;
  return String(v).trim().slice(0, max);
}

/** Validated data for create (all required present) or update (partial). */
function brandData(input: BrandInput, mode: "create" | "update") {
  const errors: Record<string, string> = {};
  const name = text(input.name, LIMITS.name);
  if (mode === "create" || name !== undefined) {
    if (!name) errors.name = sk("errors.brands.nameRequired");
  }
  const accent = input.accent_color === undefined ? undefined : String(input.accent_color).trim();
  if (accent !== undefined && !BRAND_COLOR_PATTERN.test(accent)) errors.accent_color = sk("errors.brands.colorInvalid");
  let sortOrder: number | undefined;
  if (input.sort_order !== undefined && input.sort_order !== "") {
    const n = Number(input.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 9999) errors.sort_order = sk("errors.brands.sortOrderInvalid");
    else sortOrder = n;
  }
  if (Object.keys(errors).length) throw validationError(errors);
  const data: Prisma.BrandUpdateInput = {};
  if (name !== undefined) data.name = name;
  const nameBn = text(input.name_bn, LIMITS.name);
  if (nameBn !== undefined) data.nameBn = nameBn;
  if (accent !== undefined) data.accentColor = accent.toLowerCase();
  const description = text(input.description, LIMITS.description);
  if (description !== undefined) data.description = description;
  const descriptionBn = text(input.description_bn, LIMITS.description);
  if (descriptionBn !== undefined) data.descriptionBn = descriptionBn;
  const tagline = text(input.tagline, LIMITS.tagline);
  if (tagline !== undefined) data.tagline = tagline;
  const taglineBn = text(input.tagline_bn, LIMITS.tagline);
  if (taglineBn !== undefined) data.taglineBn = taglineBn;
  const emoji = text(input.emoji, LIMITS.emoji);
  if (emoji !== undefined) data.emoji = emoji || "🍽️";
  const crust = bool(input.show_crust_guide);
  if (crust !== undefined) data.showCrustGuide = crust;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;
  const active = bool(input.is_active);
  if (active !== undefined) data.isActive = active;
  return data;
}

function assertSuperAdmin(user: User): void {
  if (user.role !== "super_admin") throw forbidden(sk("errors.brands.superAdminOnly"));
}

async function brandOrThrow(id: number): Promise<Brand> {
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound(sk("errors.brands.notFound"));
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) throw notFound(sk("errors.brands.notFound"));
  return brand;
}

/** Which fields changed, for the Activity Log line ("name, accent colour"). */
function changedFields(before: Brand, data: Prisma.BrandUpdateInput): string {
  const labels: Record<string, string> = {
    name: "name", nameBn: "Bangla name", accentColor: "accent colour", description: "description",
    descriptionBn: "Bangla description", tagline: "tagline", taglineBn: "Bangla tagline", emoji: "emoji",
    showCrustGuide: "crust guide", sortOrder: "display order", isActive: "active", logo: "logo",
  };
  const changed = Object.entries(data)
    .filter(([k, v]) => k in labels && (before as Record<string, unknown>)[k] !== v)
    .map(([k]) => labels[k]);
  return changed.length ? changed.join(", ") : "no visible change";
}

// ── Mutations (super admin only) ─────────────────────────────────────────

export async function createBrand(user: User, input: BrandInput, logo: File | null): Promise<Brand> {
  assertSuperAdmin(user);
  const slug = String(input.slug ?? "").trim().toLowerCase();
  if (!BRAND_SLUG_PATTERN.test(slug)) throw validationError({ slug: sk("errors.brands.slugInvalid") });
  if (await prisma.brand.findUnique({ where: { slug } })) {
    throw validationError({ slug: sk("errors.brands.slugTaken") });
  }
  const data = brandData(input, "create") as Prisma.BrandCreateInput;
  // New brands go to the end of the list unless an order was given.
  if (data.sortOrder === undefined) {
    const last = await prisma.brand.aggregate({ _max: { sortOrder: true } });
    data.sortOrder = (last._max.sortOrder ?? -1) + 1;
  }
  const logoKey = logo ? await saveUpload(logo, "branding", "logo") : null;
  const brand = await prisma.$transaction(async (tx) => {
    const row = await tx.brand.create({ data: { ...data, slug, logo: logoKey } });
    await logAdminAction(user.id, "action", `Created brand "${row.name}" (${row.slug}, #${row.id})`, { tx });
    return row;
  });
  revalidateCatalog();
  return brand;
}

export async function updateBrand(user: User, id: number, input: BrandInput, logo: File | null): Promise<Brand> {
  assertSuperAdmin(user);
  const before = await brandOrThrow(id);
  if (input.slug !== undefined && String(input.slug).trim().toLowerCase() !== before.slug) {
    // The slug is what products, categories and order lines point at.
    throw validationError({ slug: sk("errors.brands.slugImmutable") });
  }
  const data = brandData(input, "update");
  if (logo) data.logo = await saveUpload(logo, "branding", "logo");
  const brand = await prisma.$transaction(async (tx) => {
    const row = await tx.brand.update({ where: { id }, data });
    await logAdminAction(
      user.id,
      "action",
      `Edited brand "${row.name}" (${row.slug}, #${row.id}): ${changedFields(before, data)}`,
      { tx },
    );
    return row;
  });
  // The old logo file is only removed once the row no longer points at it.
  if (logo && before.logo && !before.logo.startsWith("/")) await deleteUpload(before.logo);
  revalidateCatalog();
  return brand;
}

/** Set the display order from a list of ids (first = shown first). */
export async function reorderBrands(user: User, ids: number[]): Promise<void> {
  assertSuperAdmin(user);
  const unique = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))];
  const existing = await prisma.brand.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  if (existing.length !== unique.length || unique.length === 0) {
    throw validationError({ ids: sk("errors.brands.reorderInvalid") });
  }
  const names = new Map(existing.map((b) => [b.id, b.name]));
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of unique.entries()) {
      await tx.brand.update({ where: { id }, data: { sortOrder: index } });
    }
    await logAdminAction(
      user.id,
      "action",
      `Reordered brands: ${unique.map((id) => names.get(id)).join(" → ")}`,
      { tx },
    );
  });
  revalidateCatalog();
}

export interface BrandUsage {
  branches: number;
  products: number;
  categories: number;
  orderLines: number;
  /** True when nothing refers to it: a permanent delete is allowed. */
  deletable: boolean;
}

export async function brandUsage(id: number): Promise<BrandUsage> {
  const brand = await brandOrThrow(id);
  const [branches, products, categories, orderLines] = await Promise.all([
    prisma.branchBrand.count({ where: { brandId: id } }),
    prisma.product.count({ where: { brand: brand.slug } }),
    prisma.category.count({ where: { brand: brand.slug } }),
    prisma.orderItem.count({ where: { brand: brand.slug } }),
  ]);
  return {
    branches,
    products,
    categories,
    orderLines,
    deletable: products === 0 && categories === 0 && orderLines === 0,
  };
}

/**
 * Archive: the brand disappears from the storefront and from every form, but
 * its products, categories and orders keep pointing at it. Branches stop
 * serving it (their BranchBrand row is removed) so it cannot linger as a dead
 * menu tab; restoring brings the brand back without re-assigning branches,
 * which stays a deliberate step.
 */
export async function archiveBrand(user: User, id: number): Promise<Brand> {
  assertSuperAdmin(user);
  const brand = await brandOrThrow(id);
  if (brand.isArchived) return brand;
  const row = await prisma.$transaction(async (tx) => {
    const servedBy = await tx.branchBrand.findMany({ where: { brandId: id }, include: { branch: { select: { name: true } } } });
    await tx.branchBrand.deleteMany({ where: { brandId: id } });
    const updated = await tx.brand.update({
      where: { id },
      data: { isArchived: true, isActive: false, archivedAt: new Date(), archivedById: user.id },
    });
    await logAdminAction(
      user.id,
      "archive",
      `Archived brand "${brand.name}" (${brand.slug}, #${brand.id})` +
        (servedBy.length ? `; removed from ${servedBy.map((s) => s.branch.name).join(", ")}` : ""),
      { tx },
    );
    return updated;
  });
  revalidateCatalog();
  return row;
}

export async function restoreBrand(user: User, id: number): Promise<Brand> {
  assertSuperAdmin(user);
  const brand = await brandOrThrow(id);
  if (!brand.isArchived) return brand;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.brand.update({
      where: { id },
      // Back as INACTIVE: going live again is its own deliberate switch.
      data: { isArchived: false, isActive: false, archivedAt: null, archivedById: null },
    });
    await logAdminAction(user.id, "action", `Restored archived brand "${brand.name}" (${brand.slug}, #${brand.id}); it stays inactive until switched on`, { tx });
    return updated;
  });
  revalidateCatalog();
  return row;
}

/** Permanent delete: only for a brand nothing has ever referred to. */
export async function deleteBrand(user: User, id: number): Promise<void> {
  assertSuperAdmin(user);
  const brand = await brandOrThrow(id);
  const usage = await brandUsage(id);
  if (!usage.deletable) throw conflict(sk("errors.brands.inUseArchiveInstead"));
  await prisma.$transaction(async (tx) => {
    await tx.branchBrand.deleteMany({ where: { brandId: id } });
    await tx.brand.delete({ where: { id } });
    await logAdminAction(user.id, "delete", `Deleted unused brand "${brand.name}" (${brand.slug}, #${brand.id})`, { tx });
  });
  if (brand.logo && !brand.logo.startsWith("/")) await deleteUpload(brand.logo);
  revalidateCatalog();
}

// ── Branch ↔ brand assignment ────────────────────────────────────────────

/**
 * Validate a submitted list of brand slugs for a branch. At least one, all
 * real and not archived. Accepts the legacy `brand_type` value too
 * (cheez | madchef | combined), so older API callers keep working: "combined"
 * means every assignable brand.
 */
export async function resolveBranchBrandIds(input: { brands?: string; brand_type?: string }): Promise<number[]> {
  const assignable = await prisma.brand.findMany({ where: { isArchived: false }, orderBy: BRAND_ORDER });
  let slugs: string[];
  if (input.brands !== undefined) {
    slugs = String(input.brands)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  } else if (input.brand_type !== undefined) {
    const legacy = String(input.brand_type).trim().toLowerCase();
    slugs = legacy === "combined" ? assignable.filter((b) => b.isActive).map((b) => b.slug) : [legacy];
  } else {
    slugs = [];
  }
  const bySlug = new Map(assignable.map((b) => [b.slug, b.id]));
  if (slugs.length === 0) throw validationError({ brands: sk("errors.brands.branchNeedsBrand") });
  const ids: number[] = [];
  for (const slug of slugs) {
    const id = bySlug.get(slug);
    if (id === undefined) throw validationError({ brands: sk("errors.brands.unknownBrand") });
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Replace the set of brands a branch serves. Refuses to remove a brand while
 * the branch still has live (not archived) products tagged with it, because
 * those products would silently vanish from the menu.
 */
export async function setBranchBrands(
  tx: Prisma.TransactionClient,
  branch: { id: number; name: string },
  brandIds: number[],
  actorId: number | null,
): Promise<void> {
  const current = await tx.branchBrand.findMany({ where: { branchId: branch.id }, include: { brand: true } });
  const removed = current.filter((c) => !brandIds.includes(c.brandId));
  const added = brandIds.filter((id) => !current.some((c) => c.brandId === id));
  for (const r of removed) {
    const live = await tx.product.count({ where: { branchId: branch.id, brand: r.brand.slug, deletedAt: null } });
    if (live > 0) {
      throw validationError({
        brands: sk("errors.brands.branchStillSellsBrand", { brand: r.brand.name, count: live }),
      });
    }
  }
  if (removed.length) await tx.branchBrand.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
  for (const brandId of added) await tx.branchBrand.create({ data: { branchId: branch.id, brandId } });
  if ((removed.length || added.length) && actorId) {
    const addedNames = added.length
      ? (await tx.brand.findMany({ where: { id: { in: added } }, select: { name: true } })).map((b) => b.name)
      : [];
    const parts = [
      addedNames.length ? `added ${addedNames.join(", ")}` : "",
      removed.length ? `removed ${removed.map((r) => r.brand.name).join(", ")}` : "",
    ].filter(Boolean);
    await logAdminAction(actorId, "action", `Changed the brands branch "${branch.name}" serves: ${parts.join("; ")}`, {
      tx,
      branchId: branch.id,
    });
  }
}
