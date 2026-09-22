import { PRODUCT_BRANDS } from "@/lib/constants/enums";

import type { Brand } from "./types";

/** Every menu tab, in display order — the first is the default one. */
export const ALL_BRANDS: readonly Brand[] = PRODUCT_BRANDS;

/**
 * The menu tabs a branch actually serves. A single-brand branch has exactly
 * one; a "combined" branch (or anything unrecognised) has both, first one first.
 */
export function brandsServedBy(branchBrandType: string | null | undefined): Brand[] {
  return (ALL_BRANDS as readonly string[]).includes(branchBrandType ?? "")
    ? [branchBrandType as Brand]
    : [...ALL_BRANDS];
}
