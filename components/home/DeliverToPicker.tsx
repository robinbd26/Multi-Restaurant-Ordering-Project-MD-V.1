"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { BarMenu, MenuHeading, RadioRow, menuRowClass } from "@/components/home/BarMenu";
import { updateBrowseScope } from "@/lib/browse-scope/client";
import type { DeliverTo } from "@/lib/browse-scope/config";
import { useTranslation } from "@/lib/i18n/use-translation";

/** A saved address, reduced to what the control draws. */
export interface DeliverToAddress {
  id: number;
  label: string;
  address: string;
  isDefault: boolean;
  /** False when the row has no readable map pin, so nothing can be delivered to it. */
  isSelectable: boolean;
}

/**
 * "Deliver to" — WHERE the order is going.
 *
 * Owns exactly one half of the browse scope. Choosing a row here moves the point
 * every coverage, fee and checkout decision is made from; it never touches which
 * branch's menu is on screen, which is the "Browsing" control's job.
 */
export function DeliverToPicker({
  deliverTo,
  addresses,
  value,
  onUseCurrentLocation,
  busy,
}: {
  deliverTo: DeliverTo;
  addresses: DeliverToAddress[];
  /** What the trigger shows — the address label, or the live-location wording. */
  value: string;
  /** Shared live-location flow, owned by the bar so there is one location system. */
  onUseCurrentLocation: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <BarMenu
      icon="📍"
      label={t("nearestHome.deliverTo")}
      value={value}
      menuLabel={t("nearestHome.deliverToMenuLabel")}
      // The long-standing "select an address" entry point, now the real one.
      testId="home-select-address"
      panelTestId="deliver-to-panel"
    >
      {(close) => (
        <>
          <RadioRow
            checked={deliverTo.mode === "gps"}
            disabled={busy}
            testId="deliver-to-gps"
            title={busy ? t("nearestHome.locating") : t("nearestHome.useMyLocation")}
            onSelect={() => {
              close();
              // Drop the address FIRST: the hook refreshes on its own once the fix
              // is saved, and a stale address would otherwise keep pricing the page.
              // Choosing where to deliver hands "Browsing" back to the nearest
              // branch for that point (the long-standing behaviour). The reverse
              // never holds: "Browsing" leaves this choice alone.
              updateBrowseScope({ deliverTo: { mode: "gps" }, branchId: null });
              onUseCurrentLocation();
              router.refresh();
            }}
          />

          <MenuHeading>{t("nearestHome.savedAddressesGroup")}</MenuHeading>
          {addresses.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[0.78rem] text-[#70707e]">
              {t("nearestHome.noSavedAddresses")}
            </p>
          ) : (
            addresses.map((a) => (
              <RadioRow
                key={a.id}
                checked={deliverTo.mode === "address" && deliverTo.addressId === a.id}
                disabled={!a.isSelectable}
                testId={`deliver-to-address-${a.id}`}
                title={a.label}
                subtitle={a.isSelectable ? a.address : t("nearestHome.noCoordinates")}
                onSelect={() => {
                  close();
                  updateBrowseScope({ deliverTo: { mode: "address", addressId: a.id }, branchId: null });
                  router.refresh();
                }}
              />
            ))
          )}
          <Link
            href="/customer/addresses"
            role="menuitem"
            className={`${menuRowClass} text-[#a0a0b0] hover:text-white`}
          >
            <span aria-hidden className="w-2.5 text-center">
              +
            </span>
            <span className="flex-1 truncate">{t("nearestHome.manageAddresses")}</span>
            <span aria-hidden>→</span>
          </Link>
        </>
      )}
    </BarMenu>
  );
}
