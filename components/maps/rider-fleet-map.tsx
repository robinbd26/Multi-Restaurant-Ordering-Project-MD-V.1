"use client";

import { useEffect, useRef } from "react";
import type { Marker } from "leaflet";

import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

import { pinIcon, useLeafletMap } from "./leaflet-core";
import { MAP_DEFAULT_CENTER } from "./map-config";

/**
 * WS-4.3 — the map behind the branch manager's rider board: one pin per rider
 * who is on duty at THIS branch and has pinged a position. Leaflet + OpenStreetMap
 * tiles; if the map library cannot load, a short explanation shows instead and the
 * caller's rider list (below) still carries every coordinate.
 *
 * PURELY PRESENTATIONAL: it fetches nothing and polls nothing. The panel above
 * it owns the one request the page makes, so the map and the roster can never
 * disagree about who is on duty.
 */

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
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { handle, status } = useLeafletMap(containerRef, { center: center ?? MAP_DEFAULT_CENTER, zoom: FLEET_ZOOM });
  const mapFailed = status === "error";

  const markersRef = useRef(new Map<number, Marker>());
  const onSelectRef = useRef(onSelect);
  /** The map is framed on the fleet ONCE; after that the manager owns the viewport. */
  const framed = useRef(false);
  const lastFocus = useRef<number | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // Reconcile pins → markers. Existing markers are MOVED rather than recreated,
  // so a rider's pin glides with each poll instead of blinking off and on.
  useEffect(() => {
    if (!handle) return;
    const { L, map } = handle;
    const live = markersRef.current;
    const seen = new Set<number>();

    for (const pin of pins) {
      seen.add(pin.riderId);
      const existing = live.get(pin.riderId);
      if (existing) {
        existing.setLatLng([pin.lat, pin.lng]);
        continue;
      }
      const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(L, "rider"), title: pin.name }).addTo(map);
      marker.on("click", () => onSelectRef.current?.(pin.riderId));
      live.set(pin.riderId, marker);
    }
    // A rider who clocked out stops being returned at all (WS-3.4), so their pin
    // must actually leave the map rather than freeze at their last position.
    for (const [riderId, marker] of live) {
      if (seen.has(riderId)) continue;
      marker.remove();
      live.delete(riderId);
    }

    // First frame with a fleet on it: centre on the riders' midpoint. After that
    // the manager's own pan/zoom is never overridden by a poll.
    if (!framed.current && pins.length > 0) {
      framed.current = true;
      const lat = pins.reduce((sum, p) => sum + p.lat, 0) / pins.length;
      const lng = pins.reduce((sum, p) => sum + p.lng, 0) / pins.length;
      map.setView([lat, lng], map.getZoom());
    }
  }, [handle, pins]);

  // The markers belong to the map instance; when it is torn down they go with it.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.clear();
      framed.current = false;
    };
  }, [handle]);

  // Tapping a roster row pulls the map to that rider.
  useEffect(() => {
    if (!handle || focusRiderId == null || focusRiderId === lastFocus.current) return;
    lastFocus.current = focusRiderId;
    const pin = pins.find((p) => p.riderId === focusRiderId);
    if (!pin) return;
    framed.current = true;
    handle.map.setView([pin.lat, pin.lng], Math.max(handle.map.getZoom(), FOCUS_ZOOM));
  }, [handle, focusRiderId, pins]);

  // No usable map on this installation — the documented degraded path. The
  // caller still lists every on-duty rider with their coordinates below, so this
  // is an explanation, never a dead grey box.
  if (mapFailed) {
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
            {t("mapPicker.loadError")}
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
      {status === "loading" ? (
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
