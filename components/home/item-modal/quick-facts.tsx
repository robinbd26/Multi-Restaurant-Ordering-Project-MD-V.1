"use client";

import type { MenuItem } from "@/lib/home/types";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * One compact row under the price: ready time, serving note, and a Veg / Spicy
 * mark. Only facts the product actually has are shown; no data, no row.
 */
export function QuickFacts({ item }: { item: MenuItem }) {
  const { t, fmt } = useTranslation();
  const facts: { key: string; icon: string; label: string }[] = [];
  if (item.preparationTime) {
    facts.push({ key: "ready", icon: "⏱", label: t("home.modal.facts.ready", { n: fmt.num(item.preparationTime) }) });
  }
  if (item.servingInfo) facts.push({ key: "serving", icon: "🍽", label: item.servingInfo });
  if (item.vegetarian) facts.push({ key: "veg", icon: "🌿", label: t("home.product.badge.veg") });
  if (item.spicy) facts.push({ key: "spicy", icon: "🌶", label: t("home.product.spicy") });
  if (facts.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.76rem] text-[#a0a0b0]" data-testid="quick-facts">
      {facts.map((f) => (
        <li key={f.key} className="flex items-center gap-1.5">
          <span aria-hidden>{f.icon}</span>
          {f.label}
        </li>
      ))}
    </ul>
  );
}
