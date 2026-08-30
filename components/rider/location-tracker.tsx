"use client";

import { useEffect, useRef, useState } from "react";

import { haversineKm } from "@/lib/services/geo";
import { useTranslation } from "@/lib/i18n/use-translation";

// WS-9.4 — persist budget for a prepaid 3G/4G Android phone. `watchPosition`
// with high accuracy can fire every second; writing each fix would cost
// hundreds of requests (and battery wakeups) per hour of duty. A delivery bike
// at ~30 km/h moves ~125 m in 15 s, so one write per 15 s loses nothing a
// dispatcher can act on, and a stationary rider (waiting at the branch) writes
// nothing at all.
const PERSIST_INTERVAL_MS = 15_000; // at most one network write per 15 s…
const MIN_MOVE_M = 25; // …and only if the rider actually moved ≥ ~25 m (GPS jitter is below this)
const JUMP_M = 250; // a significant jump (tunnel exit, GPS re-lock) is persisted immediately

/**
 * Rider GPS tracker (req #12). While the rider is on duty, requests browser
 * geolocation once, then watches position and pushes throttled updates to
 * /api/riders/location (server validates + requires an active duty session).
 * Handles granted / denied / unavailable / timeout without re-prompting in a
 * loop. Stops when `onDuty` is false. Renders a tiny non-blocking status chip.
 *
 * Only the network WRITE is throttled — every raw callback still updates the
 * status chip, so the rider sees GPS health live.
 */
export function RiderLocationTracker({ onDuty }: { onDuty: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "on" | "denied" | "unavailable">("idle");
  const lastSent = useRef(0);
  const lastPoint = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!onDuty) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // Defer out of the effect body (avoids sync setState-in-effect).
      const id = setTimeout(() => setStatus("unavailable"), 0);
      return () => clearTimeout(id);
    }
    let watchId: number | null = null;
    const send = (lat: number, lng: number, accuracy?: number, capturedAt?: number) => {
      const now = Date.now();
      // Metres since the last PERSISTED point (client-side haversine).
      const movedM = lastPoint.current
        ? haversineKm(lastPoint.current, { lat, lng }) * 1000
        : Infinity;
      const firstFix = !lastPoint.current; // just went on duty — persist immediately
      const due = now - lastSent.current >= PERSIST_INTERVAL_MS && movedM >= MIN_MOVE_M;
      if (!firstFix && movedM < JUMP_M && !due) return;
      lastSent.current = now;
      lastPoint.current = { lat, lng };
      void fetch("/api/riders/location/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // PHASE E — capture time travels with the fix; the server refuses a
        // stale one instead of recording an old position as the rider's current.
        body: JSON.stringify({ lat, lng, accuracy, captured_at: capturedAt ?? Date.now() }),
      }).catch(() => {});
    };

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("on");
        send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp);
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      // Forget the trail on going off duty, so the NEXT duty session starts
      // with an immediate first-fix persist even from the same spot.
      lastSent.current = 0;
      lastPoint.current = null;
    };
  }, [onDuty]);

  // PHASE E — the rider always sees the GPS state while on duty, including the
  // healthy one. A silent tracker leaves them unable to tell "working" from
  // "quietly broken".
  if (!onDuty || status === "idle") return null;
  const tone =
    status === "on" ? "bg-emerald-600/90" : status === "denied" ? "bg-red-600/90" : "bg-amber-500/90";
  return (
    <div
      className={`fixed bottom-3 left-3 z-40 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow ${tone}`}
      data-testid="rider-gps-status"
      data-status={status}
    >
      {status === "on"
        ? t("location.riderTracking")
        : status === "denied"
          ? t("location.riderDenied")
          : t("location.riderUnavailable")}
    </div>
  );
}
