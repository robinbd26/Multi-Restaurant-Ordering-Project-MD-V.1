"use client";

import { useEffect, useRef } from "react";

import { useTranslation } from "@/lib/i18n/use-translation";
import { directionsUrl } from "@/lib/services/geo";
import { cn } from "@/lib/utils";

import { fitPoints, pinIcon, useLeafletMap } from "./leaflet-core";

/**
 * A small, display-only map of where an order is going: the customer's pin, and
 * optionally the branch it leaves from, with an "Open in Google Maps" link for
 * navigation. The link is just a URL built from the coordinates — no API key.
 *
 * Used wherever an order's delivery address is shown to the branch or a rider.
 * With no coordinates (pickup orders, very old orders) it renders nothing, so
 * callers can drop it in unconditionally.
 */
export function OrderLocationMap({
  lat,
  lng,
  branch,
  className,
  heightClass = "h-40",
  testId = "order-location-map",
  kind = "customer",
  showLink = true,
}: {
  lat: number | string | null | undefined;
  lng: number | string | null | undefined;
  branch?: { lat: number | string | null | undefined; lng: number | string | null | undefined; name?: string } | null;
  className?: string;
  heightClass?: string;
  testId?: string;
  /** Whose pin the main coordinate is: the customer's (default) or a branch's. */
  kind?: "customer" | "branch";
  showLink?: boolean;
}) {
  const { t } = useTranslation();
  const dest = toPoint(lat, lng);
  const origin = branch ? toPoint(branch.lat, branch.lng) : null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { handle, status } = useLeafletMap(containerRef, { center: dest, zoom: 15, interactive: false }, dest != null);
  const destLat = dest?.lat;
  const destLng = dest?.lng;
  const originLat = origin?.lat;
  const originLng = origin?.lng;

  useEffect(() => {
    if (!handle || destLat == null || destLng == null) return;
    const { L, map } = handle;
    const layers = [L.marker([destLat, destLng], { icon: pinIcon(L, kind), interactive: false }).addTo(map)];
    const points = [{ lat: destLat, lng: destLng }];
    if (originLat != null && originLng != null) {
      layers.push(
        L.marker([originLat, originLng], { icon: pinIcon(L, "branch"), interactive: false }).addTo(map),
      );
      points.push({ lat: originLat, lng: originLng });
    }
    fitPoints(map, L, points);
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [handle, destLat, destLng, originLat, originLng, kind]);

  if (!dest) return null;
  return (
    <div className={cn("space-y-2", className)} data-testid={testId}>
      {status !== "error" ? (
        <div ref={containerRef} className={cn("w-full overflow-hidden rounded-xl border border-border-base", heightClass)} />
      ) : null}
      {showLink ? <a
        href={directionsUrl(dest)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-9 items-center text-sm font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
        data-testid={`${testId}-link`}
      >
        {t("orderMap.openInGoogleMaps")}
      </a> : null}
    </div>
  );
}

function toPoint(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null;
}
