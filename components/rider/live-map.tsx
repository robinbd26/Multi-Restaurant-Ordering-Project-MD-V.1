"use client";

import { useEffect, useRef } from "react";
import type { Marker } from "leaflet";

import { pinIcon, useLeafletMap } from "@/components/maps/leaflet-core";
import { useLiveData } from "@/lib/hooks/use-live-data";
import { useTranslation } from "@/lib/i18n/use-translation";
import { haversineKm } from "@/lib/services/geo";

interface Loc {
  is_online: boolean;
  latitude: string | null;
  longitude: string | null;
  last_ping_at: string | null;
  rider_name: string;
}

const REFRESH_MS = 20_000;

// GPS jitter sits below this and a 30 m pin move is invisible at zoom 15, so
// smaller changes do not move the marker (or re-centre the map under a customer
// who is panning it).
const MATERIAL_MOVE_KM = 0.03;

/** The Leaflet map. Mounted only once there is a coordinate to show. */
function RiderMap({ lat, lng }: { lat: number; lng: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { handle } = useLeafletMap(containerRef, { center: { lat, lng }, zoom: 15 });
  const markerRef = useRef<Marker | null>(null);
  const shownRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!handle) return;
    const { L, map } = handle;
    const shown = shownRef.current;
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon: pinIcon(L, "rider"), interactive: false }).addTo(map);
      shownRef.current = { lat, lng };
    } else if (!shown || haversineKm(shown, { lat, lng }) >= MATERIAL_MOVE_KM) {
      markerRef.current.setLatLng([lat, lng]);
      map.panTo([lat, lng]);
      shownRef.current = { lat, lng };
    }
  }, [handle, lat, lng]);

  useEffect(() => {
    return () => {
      markerRef.current = null;
      shownRef.current = null;
    };
  }, [handle]);

  return <div ref={containerRef} className="aspect-video w-full overflow-hidden rounded-xl border border-border-base" data-testid="rider-live-map" />;
}

/**
 * Live rider-location panel: a Leaflet map with the rider's pin, or a plain
 * placeholder with the raw coordinates + last-seen time when the rider has no fix.
 *
 * The transport is the shared `useLiveData` poll rather than a bare
 * `setInterval`: it stops while the tab is hidden (a customer who switched apps
 * on prepaid mobile data stops paying for it), never overlaps requests, and
 * keeps the last good fix on screen through a blip.
 *
 * WS-3.4 — the endpoint decides what this component is allowed to see. An
 * off-duty rider comes back with `is_online: false` and NULL coordinates, so
 * "the rider clocked out" renders as the no-location state rather than as a
 * stale pin the customer would read as live.
 */
export function LiveMap({ riderId }: { riderId: number }) {
  const { t, fmt } = useTranslation();
  const { data: loc } = useLiveData<Loc>(`/api/riders/${riderId}/location`, REFRESH_MS);

  const hasCoords = loc?.latitude && loc?.longitude;

  if (hasCoords) {
    return <RiderMap lat={Number(loc!.latitude)} lng={Number(loc!.longitude)} />;
  }

  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-linear-to-br from-slate-100 to-slate-200">
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle, #94a3b8 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
      <div className="relative text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-500/20 ring-4 ring-brand-500/10">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-500 text-white">🛵</span>
        </div>
        <p className="mt-3 text-sm text-fg-muted">{t("riderLoc.noLocation")}</p>
        {/* Distinguish "not on duty" from "on duty, no fix yet" — without
            this they would both read as an unexplained blank map. */}
        {loc && !loc.is_online ? <p className="text-xs text-fg-subtle">{t("riderLoc.offline")}</p> : null}
        {loc?.last_ping_at ? <p className="text-xs text-fg-subtle">{fmt.dateTime(loc.last_ping_at)}</p> : null}
      </div>
    </div>
  );
}
