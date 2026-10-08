"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Circle, Layer, Polygon } from "leaflet";

import { fitPoints, useLeafletMap } from "@/components/maps/leaflet-core";
import { RadiusSlider } from "@/components/maps/shape-editor";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { circleShape, parseShape, serializeShape, type CoverageShape } from "@/lib/coverage/shape";
import type { DeliveryAreaExclusionRow } from "@/lib/delivery-areas/query";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

/** Dhaka has no daylight saving: a fixed +06:00 offset is exact all year. */
const DHAKA_OFFSET = "+06:00";
const BLOCK_MIN_KM = 0.1;
const BLOCK_MAX_KM = 3;

/** A <input type="datetime-local"> value, read as Dhaka wall time → ISO. */
function dhakaLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00${DHAKA_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Temporary blocks laid over a branch's delivery area.
 *
 * Kept deliberately simple: tap the map where delivery cannot go, size the
 * circle, optionally say why and until when, and save. The area's own shape is
 * never edited, so removing a block (or reaching its end time) brings the area
 * back exactly as it was drawn. Blocked pins become pickup-only, like a hold.
 */
export function DeliveryAreaExclusions({
  areaId,
  areaShape,
  branchCenter,
  maxRadiusKm,
  exclusions,
}: {
  areaId: number;
  areaShape: string;
  branchCenter: { lat: number; lng: number };
  maxRadiusKm: number;
  exclusions: DeliveryAreaExclusionRow[];
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(0.5);
  const [reason, setReason] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const { handle, status } = useLeafletMap(containerRef, {
    center: branchCenter,
    zoom: 13,
    fullscreen: { enter: t("mapPicker.fullscreenEnter"), exit: t("mapPicker.fullscreenExit") },
  });
  const framed = useRef(false);

  const existingKey = JSON.stringify(exclusions.map((e) => [e.id, e.shape]));
  const existing = useMemo(
    () => (JSON.parse(existingKey) as [number, string][]).map(([, shape]) => parseShape(shape)).filter(Boolean) as CoverageShape[],
    [existingKey],
  );

  // The area (blue) and the blocks already in force (red).
  useEffect(() => {
    if (!handle) return;
    const { L, map } = handle;
    const layers: Layer[] = [];
    const area = parseShape(areaShape);
    const draw = (shape: CoverageShape, style: { color: string; fillOpacity: number; dashArray?: string }) => {
      const layer =
        shape.type === "Circle"
          ? L.circle([shape.coordinates[1], shape.coordinates[0]], { radius: shape.radiusKm * 1000, weight: 2, interactive: false, ...style })
          : L.polygon(
              shape.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]),
              { weight: 2, interactive: false, ...style },
            );
      layers.push(layer.addTo(map));
      return layer;
    };
    if (area) {
      const layer = draw(area, { color: "#2563eb", fillOpacity: 0.12 });
      if (!framed.current) {
        framed.current = true;
        const bounds = (layer as Circle | Polygon).getBounds();
        map.fitBounds(bounds, { padding: [16, 16] });
      }
    } else if (!framed.current) {
      framed.current = true;
      fitPoints(map, L, [branchCenter], 14);
    }
    for (const shape of existing) draw(shape, { color: "#dc2626", fillOpacity: 0.25 });
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [handle, areaShape, existing, branchCenter]);

  // The block being placed (orange, dashed), redrawn as it moves or grows.
  useEffect(() => {
    if (!handle || !point) return;
    const { L, map } = handle;
    const circle = L.circle([point.lat, point.lng], {
      radius: radiusKm * 1000,
      color: "#ea580c",
      weight: 2,
      dashArray: "6 6",
      fillOpacity: 0.2,
      interactive: false,
    }).addTo(map);
    return () => {
      circle.remove();
    };
  }, [handle, point, radiusKm]);

  // Tap the map to place (or move) the block.
  useEffect(() => {
    if (!handle) return;
    const onClick = (e: { latlng: { lat: number; lng: number } }) => setPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    handle.map.on("click", onClick);
    return () => {
      handle.map.off("click", onClick);
    };
  }, [handle]);

  function add() {
    if (!point) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const response = await fetch(`/api/delivery-areas/${areaId}/exclusions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shape: serializeShape(circleShape(point, radiusKm)),
          reason: reason.trim(),
          ends_at: dhakaLocalToIso(endsAt),
        }),
      });
      if (!response.ok) {
        const parsed = parseFieldErrors(await response.json().catch(() => ({})), t("common.error"));
        setFieldErrors(parsed.fieldErrors);
        setError(parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error"));
        return;
      }
      setPoint(null);
      setReason("");
      setEndsAt("");
      router.refresh();
    });
  }

  function remove(id: number) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/delivery-areas/${areaId}/exclusions/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const parsed = parseFieldErrors(await response.json().catch(() => ({})), t("common.error"));
        setError(parsed.formError ?? t("common.error"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card data-testid="area-exclusions">
      <CardHeader title={t("deliveryArea.blocksTitle")} subtitle={t("deliveryArea.blocksSub")} />
      <CardContent className="space-y-4">
        <Alert tone="error" message={error} />

        {exclusions.length > 0 ? (
          <ul className="divide-y divide-border-base rounded-xl border border-border-base" data-testid="area-exclusion-list">
            {exclusions.map((e) => {
              const shape = parseShape(e.shape);
              return (
                <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`area-exclusion-${e.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg-base">
                      {e.reason || t("deliveryArea.blockNoReason")}
                      {shape?.type === "Circle" ? (
                        <span className="ml-2 text-xs font-normal text-fg-subtle">
                          {t("deliveryArea.radiusKm", { km: fmt.num(shape.radiusKm.toFixed(1)) })}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {e.ends_at ? t("deliveryArea.blockUntil", { when: fmt.dateTime(e.ends_at) }) : t("deliveryArea.blockUntilRemoved")}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => remove(e.id)}>
                    {t("deliveryArea.blockRemove")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-fg-subtle">{t("deliveryArea.blocksNone")}</p>
        )}

        <div className="relative">
          <div ref={containerRef} className="h-72 w-full rounded-xl border border-border-base sm:h-96" data-testid="area-exclusion-map" />
          {status === "loading" ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-surface-muted text-sm text-fg-muted">
              <Spinner className="size-4" /> {t("mapPicker.loading")}
            </div>
          ) : null}
        </div>
        <p className="text-xs text-fg-subtle">{point ? t("deliveryArea.blockPlaced") : t("deliveryArea.blockTapHint")}</p>

        {point ? (
          <div className="space-y-4 rounded-xl border border-border-base p-4">
            <RadiusSlider
              value={radiusKm}
              min={BLOCK_MIN_KM}
              max={Math.max(BLOCK_MIN_KM, Math.min(BLOCK_MAX_KM, maxRadiusKm))}
              onChange={setRadiusKm}
              label={t("deliveryArea.blockSize")}
              testId="area-exclusion-radius"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("deliveryArea.blockReason")} name="reason" error={fieldErrors.reason}>
                <Input
                  name="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("deliveryArea.blockReasonPlaceholder")}
                  maxLength={200}
                />
              </Field>
              <Field label={t("deliveryArea.blockEnds")} name="ends_at" hint={t("deliveryArea.blockEndsHint")} error={fieldErrors.ends_at}>
                <Input name="ends_at" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setPoint(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" variant="danger" disabled={pending} onClick={add} data-testid="area-exclusion-save">
                {t("deliveryArea.blockSave")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
