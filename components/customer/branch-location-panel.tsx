"use client";

import { useState } from "react";

import { OrderLocationMap } from "@/components/maps/order-location-map";
import { useTranslation } from "@/lib/i18n/use-translation";
import { directionsUrl } from "@/lib/services/geo";

/**
 * PHASE F — how to get to a branch: a directions link, and a map only when the
 * branch has a pin.
 *
 * The Leaflet map is mounted LAZILY, on tap, so a page listing a dozen branches
 * does not fetch a dozen maps nobody asked for.
 *
 * The address, distance and delivery verdict are NOT repeated here: the card
 * this sits in already shows them once, from the server's verdict. This panel
 * is only the way-finding actions.
 *
 * The directions link uses the branch pin when there is one (a plain URL, no key),
 * else the branch address.
 */
export function BranchLocationPanel({
  branchName,
  address,
  branchLat = null,
  branchLng = null,
}: {
  branchName: string;
  address: string;
  /** The branch's map pin, when it has one. */
  branchLat?: number | string | null;
  branchLng?: number | string | null;
}) {
  const { t } = useTranslation();
  const [showMap, setShowMap] = useState(false);
  const hasPin = branchLat != null && branchLng != null && Number.isFinite(Number(branchLat)) && Number.isFinite(Number(branchLng));

  const directions = hasPin
    ? directionsUrl({ lat: Number(branchLat), lng: Number(branchLng) })
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${branchName} ${address}`)}`;

  return (
    <div className="mt-2 rounded-lg border border-border-base p-2.5 text-xs" data-testid="branch-location-panel">
      {/* PHASE A — these are real touch targets, not text links squeezed into
          18px: they get a finger-sized hit area on a phone. */}
      <div className="flex flex-wrap gap-3">
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
