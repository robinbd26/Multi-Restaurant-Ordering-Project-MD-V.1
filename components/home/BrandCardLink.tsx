"use client";

import type { MouseEvent, ReactNode } from "react";

import { useHomeCart } from "@/components/home/home-cart-context";
import type { Brand } from "@/lib/home/types";

const MENU_SECTION_ID = "menu-section";

/**
 * A hero brand card. It scrolls to the menu like the plain anchor it replaced,
 * and also activates that brand's menu tab. The hero is a server component and
 * the active tab lives in the cart context, so this small client wrapper is
 * the bridge. A brand the browsed branch does not serve is ignored by
 * `setBrand`, so the card just scrolls.
 *
 * The scroll is smooth (instant under prefers-reduced-motion). The offset for
 * the sticky nav comes from the section's own scroll-margin-top
 * (scroll-mt-14 / md:scroll-mt-18 in MenuSection), which scrollIntoView
 * honours, so the brand tab bar lands directly under the nav. The href stays a
 * real anchor, so the card still works before hydration and with JS off.
 */
export function BrandCardLink({
  brand,
  className,
  children,
}: {
  brand: Brand;
  className?: string;
  children: ReactNode;
}) {
  const { setBrand } = useHomeCart();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    setBrand(brand);
    const target = document.getElementById(MENU_SECTION_ID);
    // Modified clicks (new tab / window) keep the browser's own behaviour.
    if (!target || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // Keep the address bar as the plain anchor left it, without a second jump.
    window.history.replaceState(null, "", `#${MENU_SECTION_ID}`);
  }

  return (
    <a
      href={`#${MENU_SECTION_ID}`}
      className={className}
      data-testid={`hero-brand-card-${brand}`}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
