"use client";

import { useCallback } from "react";

import { useHomeCart } from "@/components/home/home-cart-context";
import { brandName } from "@/lib/brands/shared";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * "Cheez! Pizza + Madchef" for a list of brand slugs, in the reader's language,
 * from the live brand list the storefront was rendered with. Slugs of brands
 * that are not live (inactive, archived) are left out: a customer is only told
 * about brands they can actually order from.
 */
export function useBrandNames(): (slugs: readonly string[]) => string {
  const { brandInfo } = useHomeCart();
  const { locale } = useTranslation();
  return useCallback(
    (slugs) =>
      slugs
        .map((slug) => brandInfo(slug))
        .filter((b) => b !== undefined)
        .map((b) => brandName(b, locale))
        .join(" + "),
    [brandInfo, locale],
  );
}
