"use client";

import type { MenuItem } from "@/lib/home/types";
import { cn } from "@/lib/utils";

/**
 * The badges a menu item wears on its card photo and in its modal. Only tags
 * that add information: never the category ("Classic"), which the section
 * heading already says.
 */
interface Badge {
  key: string;
  label: string;
  className: string;
}

export function productBadges(item: MenuItem, t: (key: string) => string): Badge[] {
  const badges: Badge[] = [];
  if (item.spicy) badges.push({ key: "spicy", label: t("home.product.spicy"), className: "border-transparent bg-[#E8192C] text-white" });
  if (item.vegetarian) badges.push({ key: "veg", label: t("home.product.badge.veg"), className: "border-[#4ade80]/35 bg-black/65 text-[#4ade80]" });
  if (item.dineInOnly) badges.push({ key: "dineIn", label: t("home.product.badge.dineInOnly"), className: "border-[#a78bfa]/35 bg-black/65 text-[#a78bfa]" });
  if (item.badgeKey === "popular") badges.push({ key: "popular", label: t("home.product.badge.popular"), className: "border-[#F5A623]/35 bg-black/65 text-[#F5A623]" });
  else if (item.badgeKey === "recommended") badges.push({ key: "recommended", label: t("home.product.badge.recommended"), className: "border-[#4ade80]/35 bg-black/65 text-[#4ade80]" });
  return badges;
}

export function ProductBadges({ badges, className }: { badges: Badge[]; className?: string }) {
  if (badges.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} data-testid="product-badges">
      {badges.map((b) => (
        <span
          key={b.key}
          data-badge={b.key}
          className={cn("rounded-md border px-2 py-0.75 text-[0.65rem] font-extrabold uppercase tracking-wide backdrop-blur", b.className)}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}
