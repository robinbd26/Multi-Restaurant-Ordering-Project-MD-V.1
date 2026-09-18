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
  /** For display wording only — a pinless address can still be selectable. */
  hasCoordinates: boolean;
  /** False only when NEITHER a map pin NOR a master-list area can resolve a branch. */
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
              updateBrowseScope({ deliverTo: { mode: "gps" } });
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
                // A pinless address still resolves a branch when its area/sub-area
                // names a real master-list locality (resolveDeliverTo — the same
                // rule checkout's own coverage-by-name already uses), so it is only
                // disabled when NEITHER a pin nor a named area can be matched.
                disabled={!a.isSelectable}
                testId={`deliver-to-address-${a.id}`}
                title={a.label}
                subtitle={a.isSelectable ? a.address : t("nearestHome.noCoordinates")}
                onSelect={() => {
                  close();
                  updateBrowseScope({ deliverTo: { mode: "address", addressId: a.id } });
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
