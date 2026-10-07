import type { BrandInfo } from "@/lib/brands/shared";

/**
 * The menu tabs a browsed branch shows: the live brands it serves, in brand
 * display order. With no branch (guests, the all-branches showcase) every live
 * brand gets a tab. Brands themselves come from the database (activeBrands()).
 */
export function brandsForStorefront(allLive: readonly BrandInfo[], servedSlugs: readonly string[] | null): BrandInfo[] {
  if (!servedSlugs) return [...allLive];
  return allLive.filter((b) => servedSlugs.includes(b.slug));
}
