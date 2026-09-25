"use client";

import { useState } from "react";

import { FoodImage } from "@/components/home/food-image";
import { useHomeCart } from "@/components/home/home-cart-context";
import { QuantityControl } from "@/components/home/item-modal/quantity-control";
import type { MenuItem } from "@/lib/home/types";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * Badge tint. Badges are now the product's own DATABASE flags (isPopular /
 * isRecommended) rather than a hardcoded menu group, so there are exactly two.
 */
const BADGE_TONE: Record<string, string> = {
  popular: "text-[#F5A623]",
  recommended: "text-[#4ade80]",
};

/** True when the item needs a configuration modal before adding. */
export function itemHasOptions(item: MenuItem): boolean {
  return Boolean(
    item.sizes?.length ||
      item.options?.length ||
      item.addOns?.length ||
      item.choiceGroups?.length ||
      // A pizza offered in both crusts needs the customer to pick one; the
      // server refuses the order without it, so it opens the modal too.
      item.variationType === "BOTH",
  );
}

export function ProductCard({
  item,
  onConfigure,
  showBranch = false,
}: {
  item: MenuItem;
  onConfigure: (item: MenuItem) => void;
  /**
   * Show the owning branch on the card. Only set when the catalogue spans more
   * than one branch (a super admin browsing all of them) — otherwise every card
   * would repeat the same name.
   */
  showBranch?: boolean;
}) {
  const { add, openCart } = useHomeCart();
  const { t, fmt } = useTranslation();
  const isMad = item.brand === "madchef";
  const accentText = isMad ? "text-brand-500" : "text-cheez-gold";
  const accentBtn = isMad ? "bg-brand-500 text-white" : "bg-cheez-gold text-[#111]";
  const hoverBorder = isMad ? "hover:border-brand-500/40" : "hover:border-cheez-gold/40";
  const hasOptions = itemHasOptions(item);
  // Card-level quantity selector (req #1): the customer picks HOW MANY before
  // ordering, and the card itself shows qty × price = line total, live.
  const [qty, setQty] = useState(1);
  const lineTotal = item.price * qty;

  /**
   * req #1 — the card's own primary action. Configured items still open the
   * existing modal (sizes/add-ons); simple items are added at the chosen
   * quantity straight into the order card, which opens immediately.
   */
  const placeOrder = () => {
    if (hasOptions) {
      onConfigure(item);
      return;
    }
    add({
      id: item.id,
      name: item.name,
      brand: item.brand,
      branchId: item.branchId,
      branchName: item.branchName,
      unitPrice: item.price,
      image: item.image,
      emoji: item.emoji,
      // A single-crust pizza carries its one crust, so the line says what is
      // being ordered (the server would apply the same crust anyway).
      variationType: item.variationType === "THICK" || item.variationType === "THIN" ? item.variationType : undefined,
      qty,
    });
    openCart();
  };

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[14px] border border-white/8 bg-surface-dark transition-all hover:-translate-y-0.5 hover:shadow-xl",
        hoverBorder,
      )}
    >
      {/* Whole-card click target (reference design: any card opens the modal). */}
      <button
        type="button"
        onClick={() => onConfigure(item)}
        aria-label={t("home.product.viewDetails", { name: item.name })}
        className="absolute inset-0 z-1 cursor-pointer"
      />
      <div className="relative aspect-square overflow-hidden bg-white/5">
        <FoodImage
          src={item.image}
          alt={item.name}
          fallback={item.emoji ?? "🍽️"}
          sizes="(max-width: 640px) 100vw, 288px"
          className="transition-transform duration-500 group-hover:scale-105"
        />
        {item.badgeKey ? (
          <span
            className={cn(
              "absolute left-2.5 top-2.5 rounded-md bg-black/65 px-2 py-1 text-[0.68rem] font-bold uppercase tracking-wide backdrop-blur",
              BADGE_TONE[item.badgeKey] ?? accentText,
            )}
          >
            {t(`home.product.badge.${item.badgeKey}`)}
          </span>
        ) : null}
        {item.spicy ? (
          <span className="absolute right-2.5 top-2.5 rounded-[5px] bg-[#E8192C] px-2 py-1 text-[0.65rem] font-extrabold uppercase tracking-wide text-white">
            {t("home.product.spicy")}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <h4 className="text-[0.95rem] font-bold leading-tight text-white">{item.name}</h4>
        {showBranch && item.branchName ? (
          <p className="text-[0.7rem] font-medium text-[#606070]" data-testid="card-branch">
            📍 {item.branchName}
          </p>
        ) : null}
        <p className="line-clamp-2 text-xs leading-5 text-[#a0a0b0]">{item.description}</p>
        <div className="mt-auto flex flex-col gap-2.5 pt-1.5">
          <div className="flex items-center justify-between">
            <span className={cn("font-display text-[1.1rem] font-extrabold", accentText)}>
              {item.fromPrice ? (
                <span className="mr-1 font-sans text-[0.72rem] font-normal text-[#606070]">{t("home.product.from")}</span>
              ) : null}
              {fmt.money(item.price)}
            </span>
            <QuantityControl qty={qty} onChange={setQty} accent={isMad ? "#f43f5e" : "#F5C518"} />
          </div>
          {/* Live line maths on the card (req #1): qty × unit price = total. */}
          <p className="text-[0.72rem] text-[#a0a0b0]" data-testid="card-line-math">
            {fmt.num(qty)} × {fmt.money(item.price)} ={" "}
            <span className={cn("font-bold", accentText)}>{fmt.money(lineTotal)}</span>
          </p>
          <button
            type="button"
            onClick={placeOrder}
            data-testid="card-place-order"
            className={cn(
              "relative z-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] py-2.5 text-[0.85rem] font-bold transition-all hover:brightness-110 active:scale-[0.98]",
              accentBtn,
            )}
          >
            🛒 {t("home.order.placeAnOrder")}
          </button>
        </div>
      </div>
    </article>
  );
}
