"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/use-translation";

import { MapPicker, type PickedPoint } from "./map-picker";

/**
 * WS-4.5 — "what does this branch actually charge here?", answered by the server.
 *
 * The branch manager edits two overlapping things: delivery ZONES (circles that
 * decide coverage) on this page, and named delivery AREAS (which carry the money
 * and the ETA) on delivery zones. Nothing ever showed them the
 * COMBINATION, so a zone could admit a customer that an area then priced —
 * or, worse, a fee typed on a zone could look authoritative while the order was
 * billed from somewhere else entirely.
 *
 * This drops a pin and asks `/api/delivery/coverage`, which now runs the single
 * resolver in lib/services/delivery.ts. What comes back is the same verdict a
 * customer standing on that spot would get: covered or not, the charge, which
 * rule produced it, the ETA, and any hold. It is a read-only probe — nothing
 * here writes.
 *
 * It reuses the WS-4.1 <MapPicker> rather than mounting a second map, so it
 * inherits the server-side search, the draggable pin and the no-key fallback.
 */

interface CoverageResponse {
  covered: boolean;
  branch_name: string;
  distance_km: number | null;
  pricing: {
    charge: string;
    source: "area" | "branch";
    covered_via: "radius" | "zone" | null;
    zone_fee: string | null;
    area_id: number | null;
    area_name: string;
    estimated_minutes: number | null;
    is_held: boolean;
    hold_reason: string;
  };
}

export function EffectiveCoveragePreview({ branchId }: { branchId: number }) {
  const { t, fmt } = useTranslation();
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [result, setResult] = useState<CoverageResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(
    async (nextLat: string, nextLng: string) => {
      if (!nextLat.trim() || !nextLng.trim()) return;
      setChecking(true);
      setError(null);
      try {
        const res = await fetch("/api/delivery/coverage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch_id: branchId, lat: Number(nextLat), lng: Number(nextLng) }),
        });
        if (!res.ok) {
          setResult(null);
          setError(t("b1.effectiveError"));
          return;
        }
        setResult((await res.json()) as CoverageResponse);
      } catch {
        setResult(null);
        setError(t("b1.effectiveError"));
      } finally {
        setChecking(false);
      }
    },
    [branchId, t],
  );

  // A deliberate pin re-checks immediately; hand-typed coordinates ("unverified")
  // wait for the button so every keystroke is not a request.
  const handlePick = useCallback(
    (point: PickedPoint) => {
      setLat(point.lat);
      setLng(point.lng);
      if (point.source !== "unverified" && point.lat && point.lng) void check(point.lat, point.lng);
    },
    [check],
  );

  const pricing = result?.pricing;
  // Surfacing the discrepancy rather than hiding it: a zone fee is typed by this
  // manager but is NOT what the order write path bills, so if it differs from the
  // effective charge they need to know before a customer finds out.
  const staleZoneFee =
    pricing && pricing.zone_fee != null && Number(pricing.zone_fee) !== Number(pricing.charge)
      ? pricing.zone_fee
      : null;

  return (
    <div className="rounded-xl border border-border-strong p-4" data-testid="effective-coverage">
      <h3 className="font-semibold text-fg-base">{t("b1.effectiveTitle")}</h3>
      <p className="mt-1 text-xs text-fg-subtle">{t("b1.effectiveHint")}</p>

      <MapPicker
        className="mt-3"
        label={t("b1.effectiveTitle")}
        lat={lat}
        lng={lng}
        onChange={handlePick}
        latName="preview_lat"
        lngName="preview_lng"
        testId="effective-coverage-map"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void check(lat, lng)}
          disabled={checking || !lat.trim() || !lng.trim()}
          data-testid="effective-coverage-check"
        >
          {checking ? <Spinner className="size-4" /> : null}
          {checking ? t("common.saving") : t("b1.effectiveCheck")}
        </Button>
      </div>
      <FieldError id="effective-coverage-error" message={error} />

      {result && pricing ? (
        <div
          className="mt-3 space-y-1 rounded-lg bg-surface-muted px-3 py-2.5 text-sm"
          role="status"
          aria-live="polite"
          data-testid="effective-coverage-result"
        >
          {result.covered ? (
            <>
              <p className="font-medium text-emerald-700 dark:text-emerald-300">✓ {t("b1.effectiveCovered")}</p>
              <p className="text-fg-base" data-testid="effective-coverage-charge">
                {t("b1.effectiveCharge", { amount: fmt.money(pricing.charge) })}
              </p>
              <p className="text-xs text-fg-subtle">
                {pricing.source === "area"
                  ? t("b1.effectiveSourceArea", { name: pricing.area_name })
                  : t("b1.effectiveSourceBranch")}
              </p>
              <p className="text-xs text-fg-subtle">
                {pricing.covered_via === "zone" ? t("b1.effectiveViaZone") : t("b1.effectiveViaRadius")}
                {result.distance_km != null ? ` · ${t("b1.effectiveDistance", { km: fmt.num(result.distance_km) })}` : ""}
              </p>
              {pricing.estimated_minutes != null ? (
                <p className="text-xs text-fg-subtle">
                  {t("b1.effectiveEstimate", { minutes: fmt.num(pricing.estimated_minutes) })}
                </p>
              ) : null}
              {pricing.is_held ? (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400" data-testid="effective-coverage-held">
                  {t("b1.effectiveHeld", { name: pricing.area_name })}
                  {pricing.hold_reason ? ` — ${pricing.hold_reason}` : ""}
                </p>
              ) : null}
              {staleZoneFee ? (
                <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="effective-coverage-zone-fee">
                  {t("b1.effectiveZoneFeeIgnored", { fee: fmt.money(staleZoneFee) })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="font-medium text-amber-700 dark:text-amber-300" data-testid="effective-coverage-uncovered">
              {t("b1.effectiveNotCovered")}
              {result.distance_km != null ? ` · ${t("b1.effectiveDistance", { km: fmt.num(result.distance_km) })}` : ""}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
