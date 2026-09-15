"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  DeliverToPicker,
  type DeliverToAddress,
  type DeliverToBranch,
} from "@/components/home/DeliverToPicker";
import { NearestPickupCallout } from "@/components/maps/nearest-pickup-callout";
import { clearBrowseScope, writeBrowseScope } from "@/lib/browse-scope/client";
import type { BrowseScope } from "@/lib/browse-scope/config";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useLocationRequest } from "@/lib/hooks/use-location-request";

export interface BranchBarContext {
  state: "ok" | "no-location" | "out-of-zone";
  branchName: string | null;
  brandType: string | null;
  distanceKm: number | null;
  deliveryFee: number | null;
  pickupEnabled: boolean;
  prepTimeMinutes: number | null;
  /** Whether the resolved branch can take an order right now. */
  open: boolean;
  /** Opening time ("HH:MM") shown when the branch is currently closed. */
  opensAt: string | null;
  /** The deliver-to selection in force after server validation. */
  selection: BrowseScope;
  /** The branch on screen cannot deliver to the customer's own point. */
  browseOnly: boolean;
  /** The saved address this page is priced for, when one was chosen. */
  deliverToLabel: string | null;
  /** A saved address the browsed branch CAN reach, offered as the one-click fix. */
  coveredAddress: { id: number; label: string } | null;
}

/**
 * Compact branch context strip for the AUTHENTICATED customer homepage.
 *
 * Deliberately a single slim band in the storefront's own dark palette, not a
 * dashboard panel: the brief is to add branch context without redesigning the
 * page, so it sits between the hero and the menu and takes one line on desktop.
 *
 * It carries the three states the server can resolve — a branch, no usable
 * location, or a location outside every coverage area — and in each case offers
 * only the actions that can actually change the outcome.
 *
 * The bar now also carries the customer's CHOICE of what to look at, through
 * <DeliverToPicker>: their live location, one of their saved addresses, or any
 * live branch. Picking a branch that cannot reach them is allowed and says so —
 * "I am in Mirpur now but I will be in Banani at five" is a real thing to want,
 * and so is ordering to an address you are not standing at. What the choice does
 * NOT do is move the delivery decision into the browser: a delivery order still
 * has its branch, coverage and fee derived server-side from the trusted point.
 */
export function BranchBar({
  context,
  addresses,
  branches,
}: {
  context: BranchBarContext;
  addresses: DeliverToAddress[];
  branches: DeliverToBranch[];
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  // Same shared live-location flow the location card uses — no second location
  // system, no client-side distance maths. The server re-derives the nearest
  // branch on the refresh the hook performs.
  const { request, phase, busy, saveError } = useLocationRequest();

  // A refusal is not an error state to nag about — the saved default address is
  // the documented fallback, so point at it; other failures surface a short
  // inline message.
  const error =
    phase === "denied"
      ? t("nearestHome.deniedUseAddress")
      : phase === "unsupported"
        ? t("location.errUnsupported")
        : phase === "unavailable" || phase === "timeout"
          ? t("location.errUnavailable")
          : phase === "error"
            ? saveError ?? t("location.errUnavailable")
            : null;

  const action =
    "rounded-lg border border-white/15 px-3 py-1.5 text-[0.78rem] font-semibold text-white transition-colors hover:border-brand-500 hover:bg-white/5 disabled:opacity-60";

  // What the pill says it is doing. "Browsing" when the branch on screen cannot
  // deliver here, the address label when the page is priced for a saved address,
  // otherwise the ordinary "delivering from this branch".
  const triggerLabel = context.browseOnly
    ? t("nearestHome.browsingFrom")
    : context.deliverToLabel
      ? t("nearestHome.deliverToAddress", { label: context.deliverToLabel })
      : t("nearestHome.deliverTo");
  const triggerValue = context.branchName ?? t("nearestHome.useMyLocation");

  // The picker is the real "select an address" entry point now, so it carries
  // that test id — and it stays OUTSIDE the collapsed panel in every state, so
  // the primary actions are always one click and always visible.
  const picker = (
    <DeliverToPicker
      selection={context.selection}
      addresses={addresses}
      branches={branches}
      triggerLabel={triggerLabel}
      triggerValue={triggerValue}
      onUseCurrentLocation={request}
      busy={busy}
      testId="home-select-address"
    />
  );

  return (
    <section
      className="border-b border-white/8 bg-[#111115] px-4 py-3"
      data-testid="home-branch-bar"
      data-branch-state={context.state}
      data-browse-only={context.browseOnly ? "true" : "false"}
      aria-label={t("nearestHome.regionLabel")}
    >
      <div className="mx-auto flex max-w-300 flex-wrap items-center gap-x-4 gap-y-2 text-[0.82rem]">
        {context.state === "ok" ? (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden>📍</span>
              <span className="text-[#a0a0b0]">{t("nearestHome.yourBranch")}</span>
              <span className="truncate font-bold text-white" data-testid="home-branch-name">
                {context.branchName}
              </span>
            </span>
            {context.brandType ? (
              <span className="rounded-full border border-white/10 bg-[#1c1c24] px-2.5 py-0.5 text-[0.72rem] font-semibold text-[#a0a0b0]">
                {t(`brandType.${context.brandType}`)}
              </span>
            ) : null}
            {!context.open && context.opensAt ? (
              <span
                className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[0.72rem] font-semibold text-amber-300"
                data-testid="home-branch-closed"
              >
                🕒 {t("nearestBranch.opensAt", { time: context.opensAt })}
              </span>
            ) : null}
            {context.distanceKm != null ? (
              <span className="text-[#a0a0b0]" data-testid="home-branch-distance">
                {t("nearestHome.distance", { km: fmt.num(context.distanceKm) })}
              </span>
            ) : null}
            {context.prepTimeMinutes != null ? (
              <span className="text-[#a0a0b0]">
                ⏱ {fmt.num(context.prepTimeMinutes)} {t("catalog.minutes")}
              </span>
            ) : null}
            {context.deliveryFee != null ? (
              <span className="text-[#a0a0b0]" data-testid="home-branch-fee">
                {t("nearestHome.deliveryFee", { fee: fmt.money(context.deliveryFee) })}
              </span>
            ) : null}
            <span className="ms-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={request}
                disabled={busy}
                className={action}
                data-testid="home-use-location"
              >
                {busy ? t("nearestHome.locating") : t("nearestHome.changeLocation")}
              </button>
              {picker}
            </span>
          </>
        ) : null}

        {context.state === "no-location" ? (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden>📍</span>
              <span className="font-semibold text-white">{t("nearestHome.locationRequired")}</span>
              <span className="truncate text-[#a0a0b0]">{t("nearestHome.locationRequiredBody")}</span>
            </span>
            <span className="ms-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={request}
                disabled={busy}
                className={action}
                data-testid="home-use-location"
              >
                {busy ? t("nearestHome.locating") : t("nearestHome.useCurrentLocation")}
              </button>
              {picker}
            </span>
          </>
        ) : null}

        {context.state === "out-of-zone" ? (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden>⚠️</span>
              <span className="font-semibold text-white">{t("outOfZone.title")}</span>
              <span className="truncate text-[#a0a0b0]">{t("nearestHome.outOfZoneBody")}</span>
            </span>
            <span className="ms-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={request}
                disabled={busy}
                className={action}
                data-testid="home-retry-location"
              >
                {busy ? t("nearestHome.locating") : t("outOfZone.retry")}
              </button>
              {picker}
              <Link href="/customer/branches" className={action} data-testid="home-view-branches">
                {t("nearestHome.viewBranches")}
              </Link>
            </span>
          </>
        ) : null}
      </div>

      {/* The honest second line. A branch the customer chose to look at may not
          be able to deliver to them — that is the point of being allowed to look
          — so say it plainly instead of letting them build a cart that checkout
          would refuse, and offer the two things that DO work: self-pickup from
          this branch, or delivering to a saved address this branch can reach. */}
      {context.browseOnly ? (
        <div
          className="mx-auto mt-2 flex max-w-300 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[0.78rem]"
          data-testid="home-browse-only"
        >
          <span className="font-semibold text-amber-300">{t("nearestHome.browseOnlyTitle")}</span>
          <span className="text-[#c8c8d4]">
            {t("nearestHome.browseOnlyBody", { branch: context.branchName ?? "" })}
            {context.pickupEnabled ? ` ${t("nearestHome.browseOnlyPickup")}` : ""}
          </span>
          <span className="ms-auto flex flex-wrap items-center gap-2">
            {context.coveredAddress ? (
              <button
                type="button"
                data-testid="home-deliver-to-covered"
                onClick={() => {
                  writeBrowseScope({ mode: "address", addressId: context.coveredAddress!.id });
                  router.refresh();
                }}
                className={action}
              >
                {t("nearestHome.deliverToInstead", { label: context.coveredAddress.label })}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="home-back-to-location"
              onClick={() => {
                clearBrowseScope();
                router.refresh();
              }}
              className={action}
            >
              {t("nearestHome.backToMyLocation")}
            </button>
          </span>
        </div>
      ) : null}

      {/* WS-4.4 — the strip states the problem; this states the alternative. The
          nearest pickup branch is named with its distance and a route link,
          from the same server-resolved point the strip was built from. It is
          mounted only in the out-of-zone state, so a covered customer's
          homepage never makes this request. */}
      {context.state === "out-of-zone" ? (
        <NearestPickupCallout tone="dark" className="mx-auto mt-2 max-w-300" />
      ) : null}

      {error ? (
        <p className="mx-auto mt-2 max-w-300 text-[0.78rem] text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
