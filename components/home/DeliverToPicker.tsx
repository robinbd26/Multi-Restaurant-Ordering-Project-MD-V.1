"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { clearBrowseScope, writeBrowseScope } from "@/lib/browse-scope/client";
import { sameBrowseScope, type BrowseScope } from "@/lib/browse-scope/config";
import { useTranslation } from "@/lib/i18n/use-translation";

/** A saved address, reduced to what the picker draws. */
export interface DeliverToAddress {
  id: number;
  label: string;
  address: string;
  isDefault: boolean;
  /** Without a map pin an address cannot resolve a branch, so it cannot be picked. */
  hasCoordinates: boolean;
}

/** A live branch, from the same public list the rest of the homepage renders. */
export interface DeliverToBranch {
  id: number;
  name: string;
  brandType: string;
  open: boolean;
}

/**
 * ONE control for the two questions the storefront used to conflate: where the
 * order is going, and whose menu is on screen.
 *
 * A single pill in the branch bar's own palette opens a single panel with three
 * sections — the live location, the customer's saved addresses, then every live
 * branch. A separate "addresses" dropdown beside a separate "branches" dropdown
 * was the other candidate; it splits one decision across two controls and reads
 * as two unrelated filters, when in practice a customer picks exactly one of
 * these rows at a time. Radio semantics say that out loud.
 *
 * The choice is written to a cookie and the server re-renders from it — the same
 * shape the locale switcher uses. router.refresh() is enough here (unlike the
 * locale, which also lives in a client context a soft refresh would leave stale),
 * so the page updates without a full reload and the cart survives.
 */
export function DeliverToPicker({
  selection,
  addresses,
  branches,
  triggerLabel,
  triggerValue,
  onUseCurrentLocation,
  busy,
  testId,
}: {
  selection: BrowseScope;
  addresses: DeliverToAddress[];
  branches: DeliverToBranch[];
  /** "Delivering from" / "Browsing" — the bar decides which one is truthful. */
  triggerLabel: string;
  /** The branch or address name the page actually resolved. */
  triggerValue: string;
  /** Shared live-location flow, owned by the bar so there is one location system. */
  onUseCurrentLocation: () => void;
  busy: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function choose(scope: BrowseScope) {
    setOpen(false);
    writeBrowseScope(scope);
    router.refresh();
  }

  function useLocation() {
    setOpen(false);
    // Clear the scope FIRST: the hook refreshes on its own once the fix is saved,
    // and a stale cookie would otherwise pin the page to the old choice.
    clearBrowseScope();
    onUseCurrentLocation();
    router.refresh();
  }

  const row =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[0.8rem] text-white transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  const heading =
    "px-2.5 pt-3 pb-1 text-[0.68rem] font-bold tracking-wider text-[#70707e] uppercase";

  const isGps = selection.mode === "gps";

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        className="flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-[0.78rem] font-semibold text-white transition-colors hover:border-brand-500 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
      >
        <span aria-hidden>📍</span>
        <span className="text-[#a0a0b0]">{triggerLabel}</span>
        <span className="max-w-40 truncate font-bold sm:max-w-64">{triggerValue}</span>
        <span aria-hidden className="text-[#70707e]">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t("nearestHome.pickerLabel")}
          data-testid="deliver-to-panel"
          className="absolute end-0 z-50 mt-2 max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-white/12 bg-[#17171d] p-1.5 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={isGps}
            onClick={useLocation}
            disabled={busy}
            data-testid="deliver-to-gps"
            className={`${row} disabled:opacity-60`}
          >
            <Dot on={isGps} />
            <span className="flex-1 truncate font-semibold">
              {busy ? t("nearestHome.locating") : t("nearestHome.useMyLocation")}
            </span>
          </button>

          <p className={heading}>{t("nearestHome.savedAddressesGroup")}</p>
          {addresses.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[0.78rem] text-[#70707e]">
              {t("nearestHome.noSavedAddresses")}
            </p>
          ) : (
            addresses.map((a) => {
              const scope: BrowseScope = { mode: "address", addressId: a.id };
              const active = sameBrowseScope(selection, scope);
              return (
                <button
                  key={a.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  // An address with no map pin cannot resolve a branch. Disabled
                  // with the reason shown, rather than hidden — a customer who
                  // saved it should see why it is not on offer.
                  disabled={!a.hasCoordinates}
                  onClick={() => choose(scope)}
                  data-testid={`deliver-to-address-${a.id}`}
                  className={`${row} disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <Dot on={active} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.label}</span>
                    <span className="block truncate text-[0.72rem] text-[#8a8a98]">
                      {a.hasCoordinates ? a.address : t("nearestHome.noCoordinates")}
                    </span>
                  </span>
                </button>
              );
            })
          )}
          <Link
            href="/customer/addresses"
            role="menuitem"
            className={`${row} text-[#a0a0b0] hover:text-white`}
          >
            <span aria-hidden className="w-2.5 text-center">
              +
            </span>
            <span className="flex-1 truncate">{t("nearestHome.manageAddresses")}</span>
            <span aria-hidden>→</span>
          </Link>

          <p className={heading}>{t("nearestHome.otherBranchesGroup")}</p>
          {branches.map((b) => {
            const scope: BrowseScope = { mode: "branch", branchId: b.id };
            const active = sameBrowseScope(selection, scope);
            return (
              <button
                key={b.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(scope)}
                data-testid={`deliver-to-branch-${b.id}`}
                className={row}
              >
                <Dot on={active} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{b.name}</span>
                  <span className="block truncate text-[0.72rem] text-[#8a8a98]">
                    {t(`brandType.${b.brandType}`)}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
                    b.open
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border border-white/10 bg-white/5 text-[#8a8a98]"
                  }`}
                >
                  {b.open ? t("nearestHome.branchOpen") : t("nearestHome.branchClosed")}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The radio dot. A filled disc rather than a checkmark: these rows are one choice. */
function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
        on ? "border-brand-500 bg-brand-500" : "border-white/25"
      }`}
    />
  );
}
