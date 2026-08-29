"use client";

import { useEffect, useRef } from "react";

import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

import type { GMap, GMarker, GMapsListener } from "./google-maps-types";
import { mapsApiKey, useGoogleMaps } from "./use-google-maps";

/**
 * WS-4.3 — the map behind the branch manager's rider board: one pin per rider
 * who is on duty at THIS branch and has pinged a position.
 *
 * It is deliberately the same Google Maps seam the WS-4.1 picker uses
 * (`use-google-maps.ts`, `google-maps-types.ts`) rather than a second map stack:
 * one lazily-injected SDK, one shared module-level loader promise, one
 * `gm_authFailure` hook, and the same documented degradation when
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is missing or rejected — the caller renders
 * its rider list either way, so a missing key costs the manager the pins, never
 * the information.
 *
 * PURELY PRESENTATIONAL: it fetches nothing and polls nothing. The panel above
 * it owns the one request the page makes, so the map and the roster can never
 * disagree about who is on duty.
 */

/** Dhaka — the frame every map in this product opens on. */
const DHAKA = { lat: 23.8103, lng: 90.4125 };
const FLEET_ZOOM = 13;
const FOCUS_ZOOM = 16;

export interface FleetPin {
  riderId: number;
  name: string;
  lat: number;
  lng: number;
}

export function RiderFleetMap({
  pins,
  center,
  focusRiderId,
  onSelect,
  className,
  testId = "rider-fleet-map",
}: {
  pins: FleetPin[];
  /** Where to open before any rider has pinged — normally the branch itself. */
  center: { lat: number; lng: number } | null;
  /** Pan to this rider when it changes (the roster row the manager tapped). */
  focusRiderId?: number | null;
  onSelect?: (riderId: number) => void;
  className?: string;
  testId?: string;
}) {
  const { t, locale } = useTranslation();
  const hasKey = mapsApiKey().length > 0;
  // Unlike the picker there is nothing to "open" here: the map IS the panel, so
  // the SDK loads as soon as the manager reaches this page.
  const { status, maps } = useGoogleMaps(hasKey, locale === "en" ? "en" : "bn");
  const mapFailed = status === "error" || status === "unavailable";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef(new Map<number, { marker: GMarker; listener: GMapsListener }>());
  /** Written after render, read by the build effect — see the picker's note. */
  const centerRef = useRef(center);
  const onSelectRef = useRef(onSelect);
  /** The map is framed on the fleet ONCE; after that the manager owns the viewport. */
  const framed = useRef(false);
  const lastFocus = useRef<number | null>(null);

  useEffect(() => {
    centerRef.current = center;
    onSelectRef.current = onSelect;
  });

  // Build the map once the SDK is ready. Depends on the SDK alone so a moving
  // fleet never tears the map down and rebuilds it under the manager's finger.
  useEffect(() => {
    if (!maps || !containerRef.current || mapRef.current) return;
    const markers = markersRef.current;
    mapRef.current = new maps.Map(containerRef.current, {
      center: centerRef.current ?? DHAKA,
      zoom: FLEET_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: "greedy",
      clickableIcons: false,
    });
    return () => {
      for (const { marker, listener } of markers.values()) {
        listener.remove();
        marker.setMap(null);
      }
      markers.clear();
      mapRef.current = null;
      framed.current = false;
    };
  }, [maps]);

  // Reconcile pins → markers. Existing markers are MOVED rather than recreated,
  // so a rider's pin glides with each poll instead of blinking off and on.
  useEffect(() => {
    const map = mapRef.current;
    if (!maps || !map) return;
    const live = markersRef.current;
    const seen = new Set<number>();

    for (const pin of pins) {
      seen.add(pin.riderId);
      const existing = live.get(pin.riderId);
      if (existing) {
        existing.marker.setPosition({ lat: pin.lat, lng: pin.lng });
        continue;
      }
      const marker = new maps.Marker({
        position: { lat: pin.lat, lng: pin.lng },
        map,
        title: pin.name,
      });
      const listener = marker.addListener("click", () => onSelectRef.current?.(pin.riderId));
      live.set(pin.riderId, { marker, listener });
    }
    // A rider who clocked out stops being returned at all (WS-3.4), so their pin
    // must actually leave the map rather than freeze at their last position.
    for (const [riderId, entry] of live) {
      if (seen.has(riderId)) continue;
      entry.listener.remove();
      entry.marker.setMap(null);
      live.delete(riderId);
    }

    // First frame with a fleet on it: centre on the riders' midpoint. After that
    // the manager's own pan/zoom is never overridden by a poll.
    if (!framed.current && pins.length > 0) {
      framed.current = true;
      const lat = pins.reduce((sum, p) => sum + p.lat, 0) / pins.length;
      const lng = pins.reduce((sum, p) => sum + p.lng, 0) / pins.length;
      map.setCenter({ lat, lng });
    }
  }, [maps, pins]);

  // Tapping a roster row pulls the map to that rider.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusRiderId == null || focusRiderId === lastFocus.current) return;
    lastFocus.current = focusRiderId;
    const pin = pins.find((p) => p.riderId === focusRiderId);
    if (!pin) return;
    framed.current = true;
    map.panTo({ lat: pin.lat, lng: pin.lng });
    map.setZoom(Math.max(map.getZoom() ?? FOCUS_ZOOM, FOCUS_ZOOM));
  }, [focusRiderId, pins]);

  // No usable map on this installation — the documented degraded path. The
  // caller still lists every on-duty rider with their coordinates below, so this
  // is an explanation, never a dead grey box.
  if (!hasKey || mapFailed) {
    return (
      <div
        className={cn(
          "relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-surface-muted",
          className,
        )}
        data-testid={`${testId}-fallback`}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{ backgroundImage: "radial-gradient(circle, #94a3b8 1px, transparent 1px)", backgroundSize: "20px 20px" }}
        />
        <div className="relative max-w-xs px-4 text-center">
          <span className="text-2xl" aria-hidden>
            🗺️
          </span>
          <p className="mt-1 text-sm text-fg-muted">
            {status === "error" ? t("mapPicker.loadError") : t("riderLoc.mapNote")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div
        ref={containerRef}
        className="aspect-video w-full rounded-xl border border-border-base"
        data-testid={`${testId}-canvas`}
      />
      {status !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-surface-muted text-sm text-fg-muted">
          <Spinner className="size-4" /> {t("mapPicker.loading")}
        </div>
      ) : null}
      {status === "ready" && pins.length === 0 ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-surface-card/95 px-3 py-1.5 text-xs font-medium text-fg-muted shadow"
          role="status"
          data-testid={`${testId}-empty`}
        >
          {t("bmRiders.noPins")}
        </div>
      ) : null}
    </div>
  );
}
