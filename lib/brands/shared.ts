// Client-safe brand helpers. Brands are DATA (the Brand table, managed by the
// super admin at /admin/brands); nothing in the code names a brand. Server code
// reads them through lib/services/brands.ts and hands this serialised shape to
// pages and client components.

import type { Locale } from "@/lib/i18n/config";

/** A brand as every screen renders it. `logo` is already a browser URL. */
export interface BrandInfo {
  id: number;
  /** Stable machine key stored on products, categories and order lines. */
  slug: string;
  name: string;
  name_bn: string;
  logo: string | null;
  /** "#rrggbb" */
  accent_color: string;
  /** Text colour that stays readable on top of `accent_color`. */
  accent_foreground: string;
  description: string;
  description_bn: string;
  tagline: string;
  tagline_bn: string;
  emoji: string;
  show_crust_guide: boolean;
  sort_order: number;
  is_active: boolean;
  is_archived: boolean;
}

/** Slug rule: lowercase letters, digits and dashes, 2–32 chars, letter/digit first. */
export const BRAND_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
/** Accent colour rule: a 6-digit hex colour. */
export const BRAND_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** A brand's name in the reader's language (Bangla falls back to the name). */
export function brandName(brand: Pick<BrandInfo, "name" | "name_bn">, locale: Locale): string {
  return locale === "bn" && brand.name_bn.trim() ? brand.name_bn : brand.name;
}

export function brandDescription(brand: Pick<BrandInfo, "description" | "description_bn">, locale: Locale): string {
  return locale === "bn" && brand.description_bn.trim() ? brand.description_bn : brand.description;
}

export function brandTagline(brand: Pick<BrandInfo, "tagline" | "tagline_bn">, locale: Locale): string {
  return locale === "bn" && brand.tagline_bn.trim() ? brand.tagline_bn : brand.tagline;
}

/**
 * Black or white, whichever reads better on the accent colour (WCAG relative
 * luminance). Cheez's gold takes black text and Madchef's red takes white, the
 * pairing the storefront always used, so a new brand's colour gets a readable
 * button without anyone choosing a second colour.
 */
export function accentForeground(hex: string): string {
  const m = BRAND_COLOR_PATTERN.exec(hex) ? hex.slice(1) : "e8192c";
  const channel = (i: number) => {
    const c = parseInt(m.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // Contrast against white vs against black; pick the larger.
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? "#ffffff" : "#111111";
}

/** "#f5a623" + alpha (0–1) → "#f5a6231f", for tints and borders. */
export function withAlpha(hex: string, alpha: number): string {
  const safe = BRAND_COLOR_PATTERN.test(hex) ? hex : "#e8192c";
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${safe}${a}`;
}

/** Lookup by slug; undefined when the slug is unknown (archived, typo). */
export function brandBySlug(brands: readonly BrandInfo[], slug: string | null | undefined): BrandInfo | undefined {
  if (!slug) return undefined;
  return brands.find((b) => b.slug === slug);
}
