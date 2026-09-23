"use client";

import { useState } from "react";

import { OrderLocationMap } from "@/components/maps/order-location-map";
import { useTranslation } from "@/lib/i18n/use-translation";
import { directionsUrl } from "@/lib/services/geo";

/**
 * PHASE F — branch location, with a map only when the branch has a pin.
 *
 * The Leaflet map is mounted LAZILY, on tap, so a page listing a dozen branches
 * does not fetch a dozen maps nobody asked for. Without a pin the panel is not an
 * apology — it is the information a customer actually needs: the address, the
 * server-computed distance, the coverage verdict and a directions link.
 *
 * The map is presentation only. Distance and coverage come from the server and
 * are passed in already decided; nothing here recomputes them, so a tampered
 * client cannot talk itself into a delivery it is not entitled to.
 *
 * The directions link uses the branch pin when there is one (a plain URL, no key),
 * else the branch address.
 */
export function BranchLocationPanel({
  branchName,
  address,
  distanceKm,
  covered,
  locationKnown = true,
  branchLat = null,
  branchLng = null,
}: {
  branchName: string;
  address: string;
  /** Server-computed distance, or null when the customer has no location. */
  distanceKm: number | null;
  /** Server's coverage verdict for this branch. */
  covered: boolean;
  /**
   * WS-8.14 — whether the server had a usable point to judge coverage AGAINST.
   * With no location, "not covered" is unknown rather than refused, and the
   * verdict line invites a location instead of asserting "unavailable".
   */
  locationKnown?: boolean;
  /** The branch's map pin, when it has one. */
  branchLat?: number | string | null;
  branchLng?: number | string | null;
}) {
  const { t, fmt } = useTranslation();
  const [showMap, setShowMap] = useState(false);
  const hasPin = branchLat != null && branchLng != null && Number.isFinite(Number(branchLat)) && Number.isFinite(Number(branchLng));

  const directions = hasPin
    ? directionsUrl({ lat: Number(branchLat), lng: Number(branchLng) })
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${branchName} ${address}`)}`;

  return (
    <div className="mt-2 rounded-lg border border-border-base p-2.5 text-xs" data-testid="branch-location-panel">
      <p className="text-fg-base">📍 {address}</p>
      <p className="mt-1 text-fg-subtle" data-testid="branch-location-distance">
        {distanceKm != null ? t("outOfZone.distanceKm", { km: fmt.num(distanceKm) }) : t("outOfZone.distanceUnknown")}
      </p>
      <p
        className={`mt-1 font-medium ${covered ? "text-emerald-600" : locationKnown ? "text-amber-600 dark:text-amber-400" : "text-fg-subtle"}`}
        data-testid="branch-location-coverage"
      >
        {covered
          ? t("outOfZone.deliveryAvailable")
          : locationKnown
            ? t("outOfZone.deliveryUnavailable")
            : t("outOfZone.deliveryUnknown")}
      </p>

      {/* PHASE A — these are real touch targets, not text links squeezed into
          18px: they get a finger-sized hit area on a phone. */}
      <div className="mt-2 flex flex-wrap gap-3">
        <a
          href={directions}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-8 items-center font-medium text-brand-600 hover:underline"
          data-testid="branch-directions-link"
        >
          {t("maps.directions")}
        </a>
        {hasPin && !showMap ? (
          <button
            type="button"
            className="inline-flex min-h-8 items-center font-medium text-brand-600 hover:underline"
            onClick={() => setShowMap(true)}
            data-testid="branch-show-map"
          >
            {t("maps.showMap")}
          </button>
        ) : null}
      </div>

      {hasPin && showMap ? (
        <OrderLocationMap
          lat={branchLat}
          lng={branchLng}
          kind="branch"
          showLink={false}
          className="mt-2"
          testId="branch-map-embed"
        />
      ) : null}

      {!hasPin ? (
        <p className="mt-2 text-fg-subtle" data-testid="branch-map-fallback">
          {t("maps.unavailable")}
        </p>
      ) : null}
    </div>
  );
}
