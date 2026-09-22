"use client";

import type { ReactNode } from "react";

import { useHomeCart } from "@/components/home/home-cart-context";
import type { Brand } from "@/lib/home/types";

/**
 * A hero brand card. It still scrolls to the menu like the plain anchor it
 * replaced, and now also activates that brand's menu tab. The hero is a server
 * component and the active tab lives in the cart context, so this small client
 * wrapper is the bridge. A brand the browsed branch does not serve is ignored by
 * `setBrand`, so the card just scrolls.
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
  return (
    <a
      href="#menu-section"
      className={className}
      data-testid={`hero-brand-card-${brand}`}
      onClick={() => setBrand(brand)}
    >
      {children}
    </a>
  );
}
