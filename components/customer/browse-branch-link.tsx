"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { ButtonLink } from "@/components/ui/button";
import { updateBrowseScope } from "@/lib/browse-scope/client";

/**
 * Where a Restaurants-page branch card leads: the storefront menu, scoped to that
 * branch.
 *
 * The card used to route into /customer/branches/[id]/menu — a SECOND catalogue
 * page, whose product list comes from the customer products API, which is locked
 * by design to the branch that covers the customer. Unlocking that page for a
 * non-covering branch would have rendered the wrong branch's products. Instead
 * the card sets the SAME browse scope the homepage "Browsing" control sets and
 * opens the homepage menu: one browsing implementation, one set of rules, and
 * the product API's scoping left exactly as strict as it was.
 *
 * The cookie is written in onClick, which Next's Link runs before it navigates,
 * so the server render of "/" already sees the choice.
 */
const MENU_HREF = "/#menu-section";

export function BrowseBranchLink({
  branchId,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { branchId: number }) {
  return (
    <Link
      {...props}
      href={MENU_HREF}
      onClick={(event) => {
        updateBrowseScope({ branchId });
        onClick?.(event);
      }}
    />
  );
}

export function BrowseBranchButton({
  branchId,
  onClick,
  ...props
}: Omit<ComponentProps<typeof ButtonLink>, "href"> & { branchId: number }) {
  return (
    <ButtonLink
      {...props}
      href={MENU_HREF}
      onClick={(event) => {
        updateBrowseScope({ branchId });
        onClick?.(event);
      }}
    />
  );
}
