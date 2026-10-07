// Pure helpers for "which brands does this branch serve", over a branch row
// loaded with BRANCH_BRANDS_INCLUDE. No database access here.

import type { Prisma } from "@prisma/client";

/** Include this on a Branch query to read the brands it serves. */
export const BRANCH_BRANDS_INCLUDE = {
  brands: { include: { brand: true } },
} satisfies Prisma.BranchInclude;

interface BrandLike {
  id: number;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  isArchived: boolean;
}

export interface BranchWithBrandRows {
  brands?: { brand: BrandLike }[];
}

function ordered(rows: { brand: BrandLike }[]): BrandLike[] {
  return rows.map((r) => r.brand).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Slugs of the (non-archived) brands a branch serves, in display order. */
export function branchBrandSlugsOf(branch: BranchWithBrandRows): string[] {
  return ordered(branch.brands ?? [])
    .filter((b) => !b.isArchived)
    .map((b) => b.slug);
}

/** Slugs customers can order from at this branch: active and not archived. */
export function branchLiveBrandSlugsOf(branch: BranchWithBrandRows): string[] {
  return ordered(branch.brands ?? [])
    .filter((b) => b.isActive && !b.isArchived)
    .map((b) => b.slug);
}

/**
 * DEPRECATED compatibility value for API callers written against the old
 * `brand_type` field: the single slug for a one-brand branch, "combined" for
 * several, "" for none. New code reads `brands`.
 */
export function legacyBrandType(slugs: readonly string[]): string {
  if (slugs.length === 1) return slugs[0];
  return slugs.length > 1 ? "combined" : "";
}
