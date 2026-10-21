"use client";

import { useMemo, useState } from "react";

import { FoodImage } from "@/components/home/food-image";
import { useHomeCart } from "@/components/home/home-cart-context";
import { itemHasOptions } from "@/components/home/ProductCard";
import type { MenuItem } from "@/lib/home/types";
import { useTranslation } from "@/lib/i18n/use-translation";

type Kind = "pizza" | "side" | "drink" | "main";

// Categories are free text, so the kind is read from the name.
function kindOf(item: MenuItem): Kind {
  const g = item.group ?? "";
  if (/drink|beverage|mocktail|shake|soda|juice/i.test(g)) return "drink";
  if (/pizza/i.test(g) && !/boat/i.test(g)) return "pizza";
  if (/appetizer|fries|soup|poutine|teaser|extra|sauce|dessert|boat/i.test(g)) return "side";
  return "main";
}

// What to suggest for each kind: [primary (up to 2), secondary (the rest)].
const PAIRING: Record<Kind, [Kind, Kind]> = {
  pizza: ["drink", "side"],
  side: ["pizza", "drink"],
  drink: ["side", "pizza"],
  main: ["drink", "side"],
};

const MAX = 3;

/**
 * "Goes well with": 2-3 small cards from the same branch and brand, from a
 * complementary category. Stable (no randomness) so server and client agree:
 * the starting point rotates with the product id so neighbours differ.
 */
export function GoesWellWith({
  item,
  items,
  onOpenItem,
}: {
  item: MenuItem;
  items: MenuItem[];
  onOpenItem: (item: MenuItem) => void;
}) {
  const { t, fmt } = useTranslation();
  const { add } = useHomeCart();
  const [added, setAdded] = useState<string | null>(null);

  const picks = useMemo(() => {
    const pool = items.filter(
      (o) =>
        o.id !== item.id &&
        o.brand === item.brand &&
        (o.branchId ?? null) === (item.branchId ?? null) &&
        !o.dineInOnly,
    );
    const rotate = (list: MenuItem[], n: number) => {
      if (list.length === 0 || n <= 0) return [];
      const start = Number(item.id) % list.length;
      return Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(start + i) % list.length]);
    };
    const [primary, secondary] = PAIRING[kindOf(item)];
    const first = rotate(pool.filter((o) => kindOf(o) === primary), 2);
    const second = rotate(pool.filter((o) => kindOf(o) === secondary), MAX - first.length);
    return [...first, ...second].slice(0, MAX);
  }, [item, items]);

  if (picks.length === 0) return null;
  // Products with sizes keep the size list the focus: the section stays small.
  const compact = Boolean(item.sizes?.length);

  const quickAdd = (o: MenuItem) => {
    const only = o.sizes?.find((s) => !s.dineInOnly);
    add({
      id: o.id,
      name: o.name,
      brand: o.brand,
      branchId: o.branchId,
      branchName: o.branchName,
      unitPrice: only?.price ?? o.price,
      image: o.image,
      emoji: o.emoji,
      variant: only?.label,
      variationId: only ? Number(only.key) : (o.variationId ?? null),
      variationType:
        only?.crust ?? (o.variationType === "THICK" || o.variationType === "THIN" ? o.variationType : undefined),
      qty: 1,
    });
    setAdded(o.id);
    window.setTimeout(() => setAdded((cur) => (cur === o.id ? null : cur)), 1600);
  };

  return (
    <div className={compact ? "mt-4" : "mt-5"} data-testid="goes-well-with">
      <p className="mb-2 text-[0.68rem] font-bold uppercase tracking-widest text-[#606070]">
        🤝 {t("home.modal.goesWith")}
      </p>
      <ul className="grid gap-2">
        {picks.map((o) => {
          const options = itemHasOptions(o);
          return (
            <li
              key={o.id}
              className="flex items-center gap-3 rounded-[10px] border border-white/7 bg-[#1c1c24] p-2"
              data-testid="goes-well-card"
            >
              <button
                type="button"
                onClick={() => onOpenItem(o)}
                aria-label={t("home.product.viewDetails", { name: o.name })}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={`relative shrink-0 overflow-hidden rounded-lg bg-white/5 ${compact ? "size-10" : "size-12"}`}
                >
                  <FoodImage src={o.image} alt="" fallback={o.emoji ?? "🍽️"} sizes="48px" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.82rem] font-semibold text-white">{o.name}</span>
                  <span className="block text-[0.76rem] text-[#a0a0b0]">
                    {o.fromPrice ? `${t("home.product.from")} ` : ""}
                    {fmt.money(o.price)}
                  </span>
                </span>
              </button>
              {options ? (
                <button
                  type="button"
                  onClick={() => onOpenItem(o)}
                  className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[0.72rem] font-bold text-white hover:bg-white/5"
                >
                  {t("home.modal.goesWithChoose")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => quickAdd(o)}
                  aria-label={t("home.modal.goesWithAdd", { name: o.name })}
                  data-testid="goes-well-add"
                  className="shrink-0 rounded-lg bg-white/8 px-2.5 py-1.5 text-[0.72rem] font-bold text-white hover:bg-white/15"
                >
                  {added === o.id ? `✓ ${t("home.toast.addedToCart")}` : `+ ${t("home.modal.goesWithAddShort")}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
