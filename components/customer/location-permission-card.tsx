"use client";

import { useState, useEffect, useRef } from "react";

import { Icon } from "@/components/layout/icons";
import { MapPicker } from "@/components/maps/map-picker";
import { mapsApiKey } from "@/components/maps/use-google-maps";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useLocationConsent } from "@/lib/hooks/use-location-consent";
import { LOW_ACCURACY_M, useLocationRequest } from "@/lib/hooks/use-location-request";

export interface LocationStatus {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  updatedAt: string | null;
  /** WS-4.9 — device reading or a pin the customer placed by hand. */
  source: "device_gps" | "map_pin";
}

/** Six decimals ≈ 0.1 m — the picker's own precision, so the two can be compared. */
function coord(value: number): string {
  return value.toFixed(6);
}

/**
 * Customer GPS permission + status card. Automatically requests live location
 * on mount (with browser permission) or via button, saves to /api/customer/location,
 * and refreshes the page to instantly activate nearby branches. The request +
 * save + refresh sequence is the shared `useLocationRequest` hook (§22 — one
 * live-location implementation); this component only renders the status/wording.
 *
 * WS-4.9 — the card also carries the shared `MapPicker`, so a customer whose
 * phone reported a coarse fix (±105 m is an ordinary reading in a Dhaka
 * building) can drag the pin to their gate instead of being told to walk
 * outside. GPS stays FIRST and unchanged: the map corrects it, never replaces
 * it, and the pin is only stored when the customer taps save.
 */
export function LocationPermissionCard({ initial }: { initial: LocationStatus }) {
  const { t, fmt } = useTranslation();
  const [status, setStatus] = useState<LocationStatus>(initial);
  // The pin currently shown on the map — decimal strings, the picker's shape.
  // Seeded from the saved fix, and re-seeded after every successful save so the
  // "save this pin" affordance disappears once the two agree again.
  const [pin, setPin] = useState<{ lat: string; lng: string }>({
    lat: initial.lat != null ? coord(initial.lat) : "",
    lng: initial.lng != null ? coord(initial.lng) : "",
  });
  const autoRequested = useRef(false);
  const { consent, accept } = useLocationConsent();
  const { request, savePin, phase, busy, saveError } = useLocationRequest({
    // The address card prefers an accurate fix: when the device's first reading
    // is coarse (an ordinary indoor result), the hook silently re-reads once and
    // keeps the better fix, so the ± warning appears far less often.
    improveAccuracy: true,
    onSaved: (fix) => {
      setStatus({
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        updatedAt: new Date().toISOString(),
        source: fix.source,
      });
      setPin({ lat: coord(fix.lat), lng: coord(fix.lng) });
    },
  });

  const hasLocation = status.lat != null && status.lng != null;
  // Preserve the original mount behavior: with a location already on file, show
  // the success state immediately (the hook starts "idle"); a fresh save moves
  // the phase to "saved" itself. A COARSE fix is still a saved fix — the
  // green confirmation must show, with the ± note rendered as a calm hint
  // below (never as an error-style alert that reads like the save failed).
  const showSaved = phase === "saved" || phase === "lowaccuracy" || (phase === "idle" && hasLocation);

  // The pin is "moved" only once it is a usable coordinate that differs from the
  // stored one — half-typed decimals in the no-key fallback must not offer a
  // save, and re-saving the identical point would be a pointless round trip on
  // a metered connection.
  const pinLat = Number(pin.lat);
  const pinLng = Number(pin.lng);
  const pinValid =
    pin.lat.trim() !== "" && pin.lng.trim() !== "" && Number.isFinite(pinLat) && Number.isFinite(pinLng);
  const savedKey = status.lat != null && status.lng != null ? `${coord(status.lat)},${coord(status.lng)}` : "";
  const pinMoved = pinValid && `${coord(pinLat)},${coord(pinLng)}` !== savedKey;
  // Read once, at mount, by the picker: the map opens itself ONLY for the
  // customer who has something to correct (a coarse saved fix). Everyone else
  // gets the collapsed picker and never downloads the Maps SDK.
  const startOpen = initial.accuracy != null && initial.accuracy > LOW_ACCURACY_M;
  // GRACEFUL DEGRADATION: with no Maps key the picker mounts no map at all — it
  // offers area search and labelled manual coordinates instead — so the card
  // must not tell the customer to drag a pin that is not on their screen.
  const hasMap = mapsApiKey().length > 0;

  // Re-request on landing ONLY for a visitor who already said yes to our own
  // consent card. Firing the native prompt unasked was the inconsistent part:
  // browsers ignore or block a prompt with no user gesture, and never re-show a
  // denied one. Everyone else gets the explicit button below.
  useEffect(() => {
    if (consent === "accepted" && !autoRequested.current && (!initial.lat || !initial.lng)) {
      autoRequested.current = true;
      request();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent, initial.lat, initial.lng]);

  // Pressing the button IS consenting to the browser prompt it opens.
  const enable = () => {
    accept();
    request();
  };

  // Map the terminal error phases to a translated message + tone. "lowaccuracy"
  // is deliberately NOT here: the fix WAS saved, so it gets the success alert
  // plus a muted hint (rendered in the body below), not a warning alert that
  // reads like a failure and buries the confirmation.
  const problem: { tone: "error" | "warning"; message: string } | null =
    phase === "denied"
      ? { tone: "error", message: t("location.errDenied") }
      : phase === "unavailable"
        ? { tone: "error", message: t("location.errUnavailable") }
        : phase === "timeout"
          ? { tone: "warning", message: t("location.errTimeout") }
          : phase === "unsupported"
            ? { tone: "error", message: t("location.errUnsupported") }
            : phase === "error"
              ? { tone: "error", message: saveError ?? t("location.errSave") }
              : null;

  // Coarse-but-saved fix: informational hint. The remedy is the map pin, not a
  // walk — and the retry button stays available for a fresh GPS attempt.
  const coarseNote =
    phase === "lowaccuracy"
      ? t(hasMap ? "location.lowAccuracy" : "location.lowAccuracyNoMap", {
          m: fmt.num(Math.round(status.accuracy ?? 0)),
        })
      : null;

  return (
    <div data-testid="location-card">
      <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">
            <Icon name="pin" className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-fg-base">{t("location.title")}</h3>
            <p className="mt-1 text-sm text-fg-muted">{t("location.uses")}</p>
          </div>
        </div>

        {/* Current saved status (independent of saved addresses). */}
        <div
          className="rounded-xl bg-surface-muted px-4 py-3 text-sm"
          role="status"
          aria-live="polite"
          data-testid="location-status"
        >
          {hasLocation ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                <Icon name="check" className="size-4" /> {t("location.statusSaved")}
              </span>
              {status.accuracy != null ? (
                <span className="text-fg-subtle">{t("location.accuracy", { m: fmt.num(Math.round(status.accuracy)) })}</span>
              ) : status.source === "map_pin" ? (
                // A dragged pin has no metre-accuracy: the customer placed it,
                // no instrument measured it. Quoting a ± figure here — or
                // reusing the one from the GPS fix it replaced — would be a
                // fabricated precision, so the card states the provenance
                // instead and leaves the number out.
                <span className="text-fg-subtle">{t("location.accuracyManual")}</span>
              ) : null}
              {status.updatedAt ? (
                <span className="text-fg-subtle">{t("location.savedAt", { when: fmt.dateTime(status.updatedAt) })}</span>
              ) : null}
            </div>
          ) : (
            <span className="text-fg-muted">{t("location.statusNotSet")}</span>
          )}
        </div>

        {showSaved ? <Alert tone="success" message={t("location.savedOk")} /> : null}
        {problem ? <Alert tone={problem.tone} message={problem.message} /> : null}
        {coarseNote ? (
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted" data-testid="location-coarse-note">
            ℹ️ {coarseNote}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button onClick={enable} disabled={busy} data-testid="location-enable">
            <Icon name="pin" className="size-4" />
            {busy
              ? phase === "saving"
                ? t("location.saving")
                : t("location.requesting")
              : hasLocation
                ? t("location.update")
                : t("location.enable")}
          </Button>
          {problem ? (
            <Button variant="outline" onClick={request} disabled={busy} data-testid="location-retry">
              {t("location.retry")}
            </Button>
          ) : null}
        </div>

        {/* WS-4.9 — correct the fix by hand. The shared picker does all of it:
            the lazily-loaded Maps SDK, a touch-draggable pin, tap-to-place,
            server-side search, and — with NEXT_PUBLIC_GOOGLE_MAPS_API_KEY empty
            — its own labelled fallback (area search + manual coordinates), so
            this card never shows a broken or blank map frame. Nothing is
            written until the customer confirms the pin below. */}
        <MapPicker
          label={t("location.mapTitle")}
          hint={t(hasMap ? "location.mapHint" : "location.mapHintNoMap")}
          lat={pin.lat}
          lng={pin.lng}
          onChange={(point) => setPin({ lat: point.lat, lng: point.lng })}
          latName="current_lat"
          lngName="current_lng"
          defaultOpen={startOpen}
          testId="location-map"
        />

        {pinMoved ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* An explicit confirm, not save-on-drag: a drag fires on every
                pin-down and the reverse geocode commits a second time, so
                auto-saving would POST twice per adjustment on a prepaid
                connection — and the customer could never look around the map
                without overwriting their location. */}
            <Button onClick={() => savePin(pinLat, pinLng)} disabled={busy} data-testid="location-save-pin">
              <Icon name="check" className="size-4" />
              {busy ? t("location.saving") : t("location.savePin")}
            </Button>
            <p className="text-xs text-fg-subtle">{t("location.pinMoved")}</p>
          </div>
        ) : null}
      </CardContent>
      </Card>
    </div>
  );
}
