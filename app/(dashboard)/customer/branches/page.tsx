import type { Metadata } from "next";
import Image from "next/image";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, ButtonLink } from "@/components/ui/button";
import { getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { getSessionUser } from "@/lib/auth/current-user";
import { readBrowseScope } from "@/lib/browse-scope/server";
import { getT } from "@/lib/i18n/server";
import { cn, mediaUrl } from "@/lib/utils";
import { nearestEligibleBranch, customerLocationStatus } from "@/lib/services/customer-location";
import { resolveDeliverTo } from "@/lib/services/customer-branch";
import { BranchLocationPanel } from "@/components/customer/branch-location-panel";
import { BranchesLocationGate } from "@/components/customer/branches-location-gate";
import { BrowseBranchButton, BrowseBranchLink } from "@/components/customer/browse-branch-link";
import type { Branch, Paginated } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("customer.restaurantsTitle") };
}

/**
 * req #20/#4 — Foodpanda model: every branch whose delivery radius/zones cover
 * the customer's deliver-to point is orderable, and the nearest covered (open)
 * branch is badged. When there is no location or no covered branch, a clear
 * message is shown. Search filters the list only — it never makes an uncovered
 * branch orderable.
 *
 * EVERY card is clickable. The page used to lock non-covering branches as
 * unclickable ("ordering is locked to the nearest eligible one"), which
 * contradicted the storefront, where any branch's menu can be browsed. Cards now
 * open the storefront menu through the same browse scope the homepage "Browsing"
 * control writes (BrowseBranchLink), so there is one browsing implementation. A
 * non-covering branch says so with a "Browsing only" badge; ordering is still
 * decided server-side at checkout, never by which card was clicked.
 *
 * Coverage is judged from the SAME deliver-to point the homepage uses — the saved
 * address the customer chose there, if any, else their own trusted point — so the
 * two pages cannot disagree about which branches can deliver.
 */
export default async function CustomerBranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  await requireRole("customer");
  const { t, fmt } = await getT();
  const me = (await getSessionUser())!;
  // req #11 — search runs SERVER-SIDE (trimmed, case-insensitive, matches branch
  // name / address / active delivery-area names). It filters the list only; it
  // can never make an uncovered branch orderable, because eligibility is computed
  // independently by nearestEligibleBranch below.
  const search = ((await searchParams).search ?? "").trim();
  const query = new URLSearchParams({ page_size: "100" });
  if (search) query.set("search", search);
  const target = await resolveDeliverTo(me.id, (await readBrowseScope()).deliverTo);
  const [data, nearest, locationStatus] = await Promise.all([
    getJSON<Paginated<Branch>>(`/branches/?${query.toString()}`),
    nearestEligibleBranch(me.id, target.point),
    customerLocationStatus(me.id),
  ]);
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
  const nearestId = nearest.nearest?.id ?? null;
  const distanceById = new Map(nearest.branches.map((b) => [b.id, b.distance_km]));
  const coveredById = new Map(nearest.branches.map((b) => [b.id, b.covered]));
  // Open-now is decided SERVER-SIDE (lib/services/branch-hours.ts, Asia/Dhaka) —
  // the client clock is never trusted for this (§20). A covered branch that is
  // closed right now is shown as not orderable, with an "Opens at …" note.
  const openById = new Map(nearest.branches.map((b) => [b.id, b.open_now]));
  const opensAtById = new Map(nearest.branches.map((b) => [b.id, b.opens_at]));
  const hasCoveredBranches = nearest.branches.some((b) => b.covered);
  // Out of zone = we DO know where they are, and NOTHING covers it. Coverage —
  // not opening hours — defines this: a covered-but-closed area is not out of zone
  // (that is the separate all-closed banner, owned by the gate below).
  const outOfZone = Boolean(nearest.point) && !hasCoveredBranches;
  // WS-8.14 — no usable location is NOT out of zone: a guest on the public
  // homepage can browse every branch, so a signed-in customer must not see
  // less. The location card above and the neutral "set location" note on each
  // card are the invitation. Ordering still enforces coverage at checkout.
  const noLocation = !nearest.point;

  return (
    <>
      <PageHeader title={t("customer.restaurantsTitle")} subtitle={t("customer.restaurantsSubtitle")} />

      {/* Location region (Gap #2): permission card when there is no point, a
          "Finding restaurants near you…" state while a stale saved address is
          re-checked with live GPS, and the truthful out-of-zone / all-closed
          banners with a WORKING retry. The explainer strip below stays server-
          rendered and always visible. */}
      <BranchesLocationGate
        hasPoint={Boolean(nearest.point)}
        pointSource={nearest.pointSource}
        outOfZone={outOfZone}
        allCoveredClosed={nearest.allCoveredClosed}
        nearestName={nearest.nearest?.name ?? null}
        opensAt={nearest.nearest?.opens_at ?? null}
        locationInitial={{
          lat: locationStatus.lat,
          lng: locationStatus.lng,
          accuracy: locationStatus.accuracy,
          updatedAt: locationStatus.updatedAt,
          source: locationStatus.source,
        }}
      />

      {/* Branch search (server-side GET form) */}
      <form method="GET" noValidate className="mb-4 flex flex-wrap items-center gap-2" data-testid="branch-search-form">
        <input
          type="search"
          name="search"
          defaultValue={search}
          placeholder={t("branchSearch.placeholder")}
          aria-label={t("branchSearch.placeholder")}
          data-testid="branch-search-input"
          className="w-full max-w-xs rounded-xl border border-border-strong bg-surface-card px-3.5 py-2.5 text-sm text-fg-base placeholder:text-fg-subtle focus:border-brand-500 focus:outline-2 focus:outline-brand-500/20 sm:w-auto"
        />
        <Button type="submit" size="sm" data-testid="branch-search-submit">{t("branchSearch.submit")}</Button>
        {search ? (
          <ButtonLink href="/customer/branches" size="sm" variant="outline" data-testid="branch-search-clear">
            {t("branchSearch.clear")}
          </ButtonLink>
        ) : null}
      </form>

      {/* Explanation banner */}
      <div className="mb-4 rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" data-testid="nearest-explainer">
        {hasCoveredBranches
          ? t("nearestBranch.explainerEnabled", { branch: nearest.nearest?.name ?? "" })
          : nearest.point
            ? t("nearestBranch.explainerNone")
            : t("nearestBranch.explainerNoLocation")}
        {!nearest.point ? (
          <span className="ml-2 inline-block">
            <ButtonLink href="/customer/addresses" size="sm" variant="outline">{t("nearestBranch.setLocation")}</ButtonLink>
          </span>
        ) : null}
      </div>

      {/* The out-of-zone / all-closed banners now live in BranchesLocationGate
          above, so the detecting state can suppress a premature banner (§16). */}

      {data.results.length === 0 ? (
        search ? (
          <EmptyState
            title={t("branchSearch.noResultsTitle")}
            description={t("branchSearch.noResultsDesc", { query: search })}
            action={<ButtonLink href="/customer/branches">{t("branchSearch.clear")}</ButtonLink>}
          />
        ) : (
          <EmptyState title={t("customer.noOpenRestaurants")} description={t("customer.noOpenRestaurantsDesc")} />
        )
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.results.map((branch) => {
            const logo = mediaUrl(branch.logo);
            const covered = coveredById.get(branch.id) ?? false;
            const open = openById.get(branch.id) ?? true;
            // Orderable = covered AND open now — or, with no location yet, treated
            // as orderable-pending (WS-8.14): browsing must not look refused before
            // we even know where they are.
            const orderable = (covered && open) || noLocation;
            const isNearest = branch.id === nearestId && covered && open;
            // We know where they are and this branch cannot reach it.
            const browseOnly = !noLocation && !covered;
            const closedNow = covered && !open;
            return (
              <div
                key={branch.id}
                data-testid={orderable ? "branch-enabled" : "branch-not-orderable"}
                className={cn(
                  "group flex flex-col overflow-hidden rounded-2xl border bg-surface-card shadow-card transition-all hover:shadow-card-hover",
                  orderable
                    ? "border-emerald-400/80 hover:border-emerald-500"
                    : "border-border-base/80 hover:border-border-strong",
                )}
              >
                <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-ink-900 to-ink-950">
                  {logo ? (
                    <Image src={logo} alt={branch.name} width={64} height={64} className="size-16 rounded-2xl object-cover" />
                  ) : (
                    <span className="text-4xl">🏪</span>
                  )}
                  {isNearest ? (
                    <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm" data-testid="branch-nearest-badge">
                      {t("nearestBranch.nearestBadge")}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <BrowseBranchLink branchId={branch.id} className="group/title">
                    <h3 className="font-semibold text-fg-base transition-colors group-hover/title:text-brand-600 group-hover/title:underline">{branch.name}</h3>
                  </BrowseBranchLink>
                  <p className="mt-0.5 line-clamp-1 text-sm text-fg-muted">📍 {branch.address}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-fg-subtle">
                    <span data-testid="branch-brand">{branch.brand_type}</span>
                    <span>📞 {branch.phone}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-fg-subtle">
                    <span data-testid="branch-hours">
                      {branch.opening_time && branch.closing_time
                        ? `🕒 ${branch.opening_time} – ${branch.closing_time}`
                        : t("outOfZone.hoursUnknown")}
                    </span>
                    <span>{t("customer.deliveryRadius", { km: fmt.num(branch.delivery_radius_km) })}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="text-fg-subtle" data-testid="branch-distance">
                      {distanceById.get(branch.id) != null
                        ? t("outOfZone.distanceKm", { km: fmt.num(distanceById.get(branch.id)!) })
                        : t("outOfZone.distanceUnknown")}
                    </span>
                    {covered ? (
                      <span
                        className="font-semibold text-emerald-600 dark:text-emerald-400"
                        data-testid="branch-delivery-availability"
                      >
                        {t("outOfZone.deliveryAvailable")}
                      </span>
                    ) : noLocation ? (
                      // Browsing without a location: coverage is UNKNOWN, not
                      // refused — a neutral nudge, never the amber "unavailable".
                      <span className="font-medium text-fg-subtle" data-testid="branch-delivery-availability">
                        {t("outOfZone.deliveryUnknown")}
                      </span>
                    ) : (
                      <span
                        className="font-medium text-amber-600 dark:text-amber-400"
                        data-testid="branch-delivery-availability"
                      >
                        {t("outOfZone.deliveryUnavailable")}
                      </span>
                    )}
                  </div>

                  {browseOnly ? (
                    // "Self-pickup available" only when it is true for THIS branch.
                    <span
                      className="mt-2 inline-flex w-fit rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                      data-testid="branch-browse-only-badge"
                    >
                      {branch.pickup_enabled
                        ? t("nearestHome.browseOnlyPickupBadge")
                        : t("nearestHome.browseOnlyTitle")}
                    </span>
                  ) : null}
                  {closedNow ? (
                    <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400" data-testid="branch-status-note">
                      {t("nearestBranch.opensAt", { time: opensAtById.get(branch.id) ?? branch.opening_time ?? "" })}
                    </p>
                  ) : null}

                  <BranchLocationPanel
                    branchName={branch.name}
                    address={branch.address}
                    distanceKm={distanceById.get(branch.id) ?? null}
                    covered={covered}
                    locationKnown={!noLocation}
                    mapsKey={mapsKey}
                  />

                  <div className="mt-auto pt-3">
                    <BrowseBranchButton
                      branchId={branch.id}
                      className="w-full"
                      size="sm"
                      variant={orderable ? "primary" : "outline"}
                      data-testid="branch-view-menu"
                    >
                      {t("nearestHome.viewMenu")} →
                    </BrowseBranchButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
