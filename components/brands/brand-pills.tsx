"use client";

import { brandBySlug, brandName, type BrandInfo } from "@/lib/brands/shared";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * One pill per brand slug, labelled with the brand's own name and marked with
 * its accent colour. Names come from the Brand table, never from code, so a new
 * brand shows up here without a change. A slug with no matching brand (archived
 * and filtered out by the caller, say) renders as its raw slug rather than
 * vanishing, so data is never silently hidden from staff.
 */
export function BrandPills({
  slugs,
  brands,
  emptyLabel,
  className,
}: {
  slugs: readonly string[];
  brands: readonly BrandInfo[];
  /** Shown when the list is empty (e.g. "No brand assigned"). */
  emptyLabel?: string;
  className?: string;
}) {
  const { locale } = useTranslation();
  if (slugs.length === 0) {
    return emptyLabel ? <span className={cn("text-xs text-fg-subtle", className)}>{emptyLabel}</span> : null;
  }
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)} data-testid="brand-pills">
      {slugs.map((slug) => {
        const brand = brandBySlug(brands, slug);
        return (
          <span
            key={slug}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-fg-base ring-1 ring-border-base"
            data-brand={slug}
          >
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: brand?.accent_color ?? "currentColor" }}
            />
            {brand ? brandName(brand, locale) : slug}
          </span>
        );
      })}
    </span>
  );
}
