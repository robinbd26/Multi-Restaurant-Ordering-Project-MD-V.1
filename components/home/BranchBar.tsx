"use client";

import { useRouter } from "next/navigation";

import { BrowsingPicker, type BrowseBranchOption } from "@/components/home/BrowsingPicker";
import { LocationConsentCard } from "@/components/home/LocationConsentCard";
import { DeliverToPicker, type DeliverToAddress } from "@/components/home/DeliverToPicker";
import { NearestPickupCallout } from "@/components/maps/nearest-pickup-callout";
import { updateBrowseScope } from "@/lib/browse-scope/client";
import type { BrowseScope } from "@/lib/browse-scope/config";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useLocationRequest } from "@/lib/hooks/use-location-request";

export interface BranchBarContext {
  state: "ok" | "no-location" | "out-of-zone";
  branchName: string | null;
  /** The branch on screen (explicit or resolved nearest); null outside "ok". */
  branchId: number | null;
  brandType: string | null;
  distanceKm: number | null;
  deliveryFee: number | null;
  pickupEnabled: boolean;
  prepTimeMinutes: number | null;
  /** Whether the resolved branch can take an order right now. */
  open: boolean;
  /** Opening time ("HH:MM") shown when the branch is currently closed. */
  opensAt: string | null;
  /** The deliver-to + browsing choices in force after server validation. */
  selection: BrowseScope;
  /** The branch on screen cannot deliver to the deliver-to point. */
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
 * It also carries the customer's two independent CHOICES, one control each:
 *   "Deliver to" — their live location or a saved address; where the order goes.
 *   "Browsing"   — any live branch; whose menu is on screen. This replaced the
 *                  old "View branches" button, which asked the same question by
 *                  sending the customer off to another page.
 * Picking a branch that cannot reach the deliver-to point is allowed and says so.
 * What neither choice does is move the delivery decision into the browser: a
 * delivery order still has its branch, coverage and fee derived server-side.
 */
export function BranchBar({
  context,
  addresses,
  branches,
}: {
  context: BranchBarContext;
  addresses: DeliverToAddress[];
  branches: BrowseBranchOption[];
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

  const browsingChosen = context.selection.branchId != null;

  // Each trigger states what the SERVER did, never what was merely requested.
  const deliverToValue =
    context.deliverToLabel ??
    (context.state === "no-location" ? t("nearestHome.notSetYet") : t("nearestHome.currentLocation"));
  // Nothing chosen: with a branch resolved, that branch; with no location, the
  // guest showcase of every branch; out of zone, an invitation to pick one.
  const browsingValue =
    browsingChosen || context.state === "ok"
      ? (context.branchName ?? t("nearestHome.chooseBranch"))
      : context.state === "no-location"
        ? t("nearestHome.allBranches")
        : t("nearestHome.chooseBranch");

  const controls = (
    <>
      <DeliverToPicker
        deliverTo={context.selection.deliverTo}
        addresses={addresses}
        value={deliverToValue}
        onUseCurrentLocation={request}
        busy={busy}
      />
      <BrowsingPicker
        branchId={context.selection.branchId}
        activeBranchId={context.branchId}
        branches={branches}
        value={browsingValue}
      />
    </>
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
              <span className="text-[#a0a0b0]">
                {browsingChosen ? t("nearestHome.browsingFrom") : t("nearestHome.yourBranch")}
              </span>
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
                {context.deliveryFee === 0
                  ? t("nearestHome.freeDelivery")
                  : t("nearestHome.deliveryFee", { fee: fmt.money(context.deliveryFee) })}
              </span>
            ) : null}
            <span className="ms-auto flex flex-wrap items-center gap-2">{controls}</span>
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
              {/* The one action that unlocks everything stays a single visible click. */}
              <button
                type="button"
                onClick={request}
                disabled={busy}
                className={action}
                data-testid="home-use-location"
              >
                {busy ? t("nearestHome.locating") : t("nearestHome.useCurrentLocation")}
              </button>
              {controls}
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
              {controls}
            </span>
          </>
        ) : null}
      </div>

      {/* No usable location yet: ask in our own words first. The native browser
          prompt only fires after "Accept" (a page cannot force it, and a stored
          denial can never be re-prompted), and a refusal falls back to the saved
          address / "Deliver to" picker above. */}
      {context.state === "no-location" ? <LocationConsentCard onAccept={request} busy={busy} /> : null}

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
            {context.deliverToLabel
              ? t("nearestHome.browseOnlyBodyAddress", {
                  branch: context.branchName ?? "",
                  label: context.deliverToLabel,
                })
              : t("nearestHome.browseOnlyBody", { branch: context.branchName ?? "" })}
            {context.pickupEnabled ? ` ${t("nearestHome.browseOnlyPickup")}` : ""}
          </span>
          <span className="ms-auto flex flex-wrap items-center gap-2">
            {context.coveredAddress ? (
              <button
                type="button"
                data-testid="home-deliver-to-covered"
                onClick={() => {
                  updateBrowseScope({
                    deliverTo: { mode: "address", addressId: context.coveredAddress!.id },
                  });
                  router.refresh();
                }}
                className={action}
              >
                {t("nearestHome.deliverToInstead", { label: context.coveredAddress.label })}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="home-back-to-nearest"
              onClick={() => {
                updateBrowseScope({ branchId: null });
                router.refresh();
              }}
              className={action}
            >
              {t("nearestHome.backToNearestBranch")}
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
