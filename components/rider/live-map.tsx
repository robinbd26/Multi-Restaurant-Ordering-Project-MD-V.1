"use client";

import { useLiveData } from "@/lib/hooks/use-live-data";
import { useTranslation } from "@/lib/i18n/use-translation";

interface Loc {
  is_online: boolean;
  latitude: string | null;
  longitude: string | null;
  last_ping_at: string | null;
  rider_name: string;
}

const REFRESH_MS = 20_000;

/**
 * Live rider-location panel. Renders an embedded Google Map only when
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set; otherwise shows a polished placeholder
 * with the raw coordinates + last-seen time.
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
export function LiveMap({ riderId, mapsKey }: { riderId: number; mapsKey: string | null }) {
  const { t, fmt } = useTranslation();
  const { data: loc } = useLiveData<Loc>(`/api/riders/${riderId}/location`, REFRESH_MS);

  const hasCoords = loc?.latitude && loc?.longitude;

  if (mapsKey && hasCoords) {
    const src = `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${loc!.latitude},${loc!.longitude}&zoom=15`;
    return (
      <div className="overflow-hidden rounded-xl">
        <iframe title="rider-map" src={src} className="aspect-video w-full border-0" loading="lazy" />
      </div>
    );
  }

  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-linear-to-br from-slate-100 to-slate-200">
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle, #94a3b8 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
      <div className="relative text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-500/20 ring-4 ring-brand-500/10">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-500 text-white">🛵</span>
        </div>
        {hasCoords ? (
          <>
            <p className="mt-3 text-sm font-medium text-fg-muted">
              {fmt.num(Number(loc!.latitude).toFixed(4))}, {fmt.num(Number(loc!.longitude).toFixed(4))}
            </p>
            <p className="text-xs text-fg-subtle">
              {loc!.is_online ? t("riderLoc.online") : t("riderLoc.offline")}
              {loc!.last_ping_at ? ` · ${fmt.dateTime(loc!.last_ping_at)}` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-fg-muted">{t("riderLoc.noLocation")}</p>
            {/* Distinguish "not on duty" from "on duty, no fix yet" — without
                this they would both read as an unexplained blank map. */}
            {loc && !loc.is_online ? <p className="text-xs text-fg-subtle">{t("riderLoc.offline")}</p> : null}
          </>
        )}
        {!mapsKey ? <p className="mt-1 max-w-xs text-xs text-fg-subtle">{t("riderLoc.mapNote")}</p> : null}
      </div>
    </div>
  );
}
