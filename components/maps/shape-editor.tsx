"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Circle, Layer, Marker, Polygon } from "leaflet";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Spinner } from "@/components/ui/spinner";
import {
  MAX_POLYGON_POINTS,
  MIN_POLYGON_POINTS,
  circleShape,
  circleToPolygon,
  parseShape,
  serializeShape,
  shapeReachKm,
  shapeWithinRadius,
  type CoverageShape,
} from "@/lib/coverage/shape";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

import { fitPoints, pinIcon, useLeafletMap, type Leaflet, type LeafletMap } from "./leaflet-core";

/**
 * THE delivery-area drawing surface.
 *
 * The manager sees their branch pin and the maximum-coverage circle the super
 * admin set, and draws inside it. Three ways in, all producing the same stored
 * shape (lib/coverage/shape.ts):
 *
 *   · START FROM A CIRCLE — the branch's own radius, which is the default for a
 *     new area and the fastest useful answer;
 *   · RESHAPE IT — the circle becomes a polygon whose points can be dragged, so
 *     "roughly round, but not across the lake" takes seconds;
 *   · DRAW FROM SCRATCH — tap the map to lay down points.
 *
 * The limit is enforced HERE for feedback and AGAIN on the server, which is
 * what actually refuses the save: a manager may not draw past the branch's
 * maximum radius.
 */

type Mode = "circle" | "polygon";

export function ShapeEditor({
  value,
  onChange,
  branchCenter,
  maxRadiusKm,
  /** Other areas of this branch, drawn faintly so overlaps are visible. */
  siblings = [],
  error,
  className,
  testId = "shape-editor",
}: {
  /** The stored shape JSON, or "" when nothing has been drawn yet. */
  value: string;
  onChange: (next: string) => void;
  branchCenter: { lat: number; lng: number } | null;
  maxRadiusKm: number;
  siblings?: { id: number; name: string; shape: string | null }[];
  error?: string | null;
  className?: string;
  testId?: string;
}) {
  const { t, fmt } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The parent builds `branchCenter` and `siblings` fresh on every render, and
  // every committed edit re-renders it. Keyed on those identities, the effects
  // below re-ran after each dragged point and snapped the view back to the
  // whole limit circle, throwing away the manager's zoom mid-edit. They are
  // keyed on the VALUES instead.
  const centerLat = branchCenter?.lat;
  const centerLng = branchCenter?.lng;
  const center = useMemo(
    () => (centerLat != null && centerLng != null ? { lat: centerLat, lng: centerLng } : null),
    [centerLat, centerLng],
  );
  const siblingsKey = JSON.stringify(siblings.map((s) => [s.id, s.shape]));
  const siblingShapes = useMemo(
    () => (JSON.parse(siblingsKey) as [number, string | null][]).map(([, s]) => s),
    [siblingsKey],
  );
  const { handle, status } = useLeafletMap(containerRef, {
    center: branchCenter,
    // Frame the whole allowed circle, not just the pin.
    zoom: maxRadiusKm > 6 ? 12 : maxRadiusKm > 2 ? 13 : 14,
  });

  const shape = parseShape(value);
  const [mode, setMode] = useState<Mode>(() => (shape?.type === "Polygon" ? "polygon" : "circle"));
  const [radiusKm, setRadiusKm] = useState(() =>
    shape?.type === "Circle" ? shape.radiusKm : Math.max(0.5, Math.min(maxRadiusKm, 2)),
  );

  // Layers are imperative Leaflet objects, kept in refs so React re-renders do
  // not tear the map down under the manager's finger.
  const drawnRef = useRef<Layer | null>(null);
  const vertexRef = useRef<Marker[]>([]);
  const limitRef = useRef<Circle | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const commit = useCallback((next: CoverageShape | null) => {
    onChangeRef.current(next ? serializeShape(next) : "");
  }, []);

  /** The polygon ring currently on the map, as [lng, lat] pairs. */
  const ringRef = useRef<[number, number][]>([]);

  /** The map instance whose view has already been framed — framing happens once. */
  const framedRef = useRef<LeafletMap | null>(null);

  // ── draw the fixed furniture: branch pin, limit circle, sibling areas ──
  useEffect(() => {
    if (!handle || !center) return;
    const { L, map } = handle;
    const pin = L.marker([center.lat, center.lng], {
      icon: pinIcon(L, "branch"),
      interactive: false,
    }).addTo(map);
    // The ceiling the super admin set: a dashed circle nothing may cross.
    const limit = L.circle([center.lat, center.lng], {
      radius: maxRadiusKm * 1000,
      color: "#64748b",
      weight: 1,
      dashArray: "6 6",
      fill: false,
      interactive: false,
    }).addTo(map);
    limitRef.current = limit;
    const others: Layer[] = [];
    for (const sibling of siblingShapes) {
      const parsed = parseShape(sibling);
      if (!parsed) continue;
      others.push(drawShape(L, map, parsed, { color: "#94a3b8", weight: 1, fillOpacity: 0.08 }));
    }
    // Auto-fit on first load only. After that the view is the manager's own;
    // "Start from a circle" is the one control that re-frames it on purpose.
    if (framedRef.current !== map) {
      framedRef.current = map;
      map.fitBounds(limit.getBounds(), { padding: [16, 16] });
    }
    return () => {
      pin.remove();
      limit.remove();
      limitRef.current = null;
      for (const layer of others) layer.remove();
    };
  }, [handle, center, maxRadiusKm, siblingShapes]);

  // ── render the shape being edited, and keep it editable ────────────────
  const redraw = useCallback(
    (next: CoverageShape | null) => {
      const h = handle;
      if (!h) return;
      const { L, map } = h;
      drawnRef.current?.remove();
      drawnRef.current = null;
      for (const marker of vertexRef.current) marker.remove();
      vertexRef.current = [];
      if (!next) return;

      const inside = center ? shapeWithinRadius(next, center, maxRadiusKm) : true;
      const color = inside ? "#2563eb" : "#dc2626";
      drawnRef.current = drawShape(L, map, next, { color, weight: 2, fillOpacity: 0.18 });

      if (next.type === "Polygon") {
        const ring = next.coordinates[0].slice(0, -1);
        ringRef.current = ring;
        ring.forEach(([lng, lat], index) => {
          const marker = L.marker([lat, lng], { icon: pinIcon(L, "vertex"), draggable: true }).addTo(map);
          marker.on("drag", () => {
            const p = marker.getLatLng();
            ringRef.current[index] = [p.lng, p.lat];
            const updated: CoverageShape = {
              type: "Polygon",
              coordinates: [[...ringRef.current, ringRef.current[0]]],
            };
            drawnRef.current?.remove();
            const live = center ? shapeWithinRadius(updated, center, maxRadiusKm) : true;
            drawnRef.current = drawShape(L, map, updated, {
              color: live ? "#2563eb" : "#dc2626",
              weight: 2,
              fillOpacity: 0.18,
            });
          });
          marker.on("dragend", () => {
            commit({ type: "Polygon", coordinates: [[...ringRef.current, ringRef.current[0]]] });
          });
          // Removing a point: only while the ring stays a real polygon.
          marker.on("dblclick", () => {
            if (ringRef.current.length <= MIN_POLYGON_POINTS) return;
            ringRef.current.splice(index, 1);
            commit({ type: "Polygon", coordinates: [[...ringRef.current, ringRef.current[0]]] });
          });
          vertexRef.current.push(marker);
        });
      }
    },
    [handle, center, maxRadiusKm, commit],
  );

  useEffect(() => {
    // `value` is the source of truth; redraw is keyed to the map instance.
    redraw(parseShape(value));
  }, [value, handle, redraw]);

  // Tapping the map appends a point when drawing a polygon from scratch.
  useEffect(() => {
    if (!handle || mode !== "polygon") return;
    const { map } = handle;
    const onClick = (e: { latlng: { lat: number; lng: number } }) => {
      const ring = ringRef.current;
      if (ring.length >= MAX_POLYGON_POINTS) return;
      const next = [...ring, [e.latlng.lng, e.latlng.lat] as [number, number]];
      ringRef.current = next;
      if (next.length < MIN_POLYGON_POINTS) {
        // Not a shape yet — show the points, but do not claim coverage.
        const { L } = handle;
        const marker = L.marker([e.latlng.lat, e.latlng.lng], { icon: pinIcon(L, "vertex") }).addTo(map);
        vertexRef.current.push(marker);
        return;
      }
      commit({ type: "Polygon", coordinates: [[...next, next[0]]] });
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [handle, mode, commit]);

  function applyCircle(nextRadius: number) {
    if (!center) return;
    const clamped = Math.max(0.1, Math.min(nextRadius, maxRadiusKm));
    setRadiusKm(clamped);
    setMode("circle");
    ringRef.current = [];
    commit(circleShape(center, clamped));
  }

  /** The "Start from a circle" button: a fresh start, so the view is re-framed too. */
  function startFromCircle() {
    applyCircle(radiusKm);
    const limit = limitRef.current;
    if (handle && limit) handle.map.fitBounds(limit.getBounds(), { padding: [16, 16] });
  }

  function convertToPolygon() {
    const current = parseShape(value);
    const base =
      current?.type === "Circle"
        ? circleToPolygon({ lat: current.coordinates[1], lng: current.coordinates[0] }, current.radiusKm, 16)
        : center
          ? circleToPolygon(center, Math.min(radiusKm, maxRadiusKm), 16)
          : null;
    if (!base) return;
    setMode("polygon");
    commit(base);
  }

  function startBlank() {
    setMode("polygon");
    ringRef.current = [];
    commit(null);
  }

  const current = parseShape(value);
  const reach = current && center ? shapeReachKm(current, center) : null;
  const overLimit = current && center ? !shapeWithinRadius(current, center, maxRadiusKm) : false;

  if (!center) {
    return (
      <div className={cn("rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30", className)} data-testid={`${testId}-no-branch`}>
        {t("deliveryArea.branchPinMissing")}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={mode === "circle" ? "primary" : "outline"} size="sm" onClick={startFromCircle} data-testid={`${testId}-circle`}>
          {t("deliveryArea.startFromCircle")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={convertToPolygon} data-testid={`${testId}-reshape`}>
          {t("deliveryArea.reshape")}
        </Button>
        <Button type="button" variant={mode === "polygon" && !current ? "primary" : "outline"} size="sm" onClick={startBlank} data-testid={`${testId}-blank`}>
          {t("deliveryArea.drawFromScratch")}
        </Button>
      </div>

      {mode === "circle" ? (
        <label className="flex items-center gap-3 text-sm" data-testid={`${testId}-radius`}>
          <span className="whitespace-nowrap text-fg-muted">{t("deliveryArea.radiusLabel")}</span>
          <input
            type="range"
            min={0.2}
            max={maxRadiusKm}
            step={0.1}
            value={Math.min(radiusKm, maxRadiusKm)}
            onChange={(e) => applyCircle(Number(e.target.value))}
            className="h-11 flex-1 accent-brand-500"
            aria-label={t("deliveryArea.radiusLabel")}
          />
          <span className="w-16 text-right font-medium tabular-nums">
            {t("branches.radiusN", { km: fmt.num(Math.min(radiusKm, maxRadiusKm).toFixed(1)) })}
          </span>
        </label>
      ) : null}

      <div className="relative">
        <div ref={containerRef} className="h-72 w-full rounded-xl border border-border-base sm:h-96" data-testid={`${testId}-canvas`} />
        {status === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-surface-muted text-sm text-fg-muted">
            <Spinner className="size-4" /> {t("mapPicker.loading")}
          </div>
        ) : null}
        {status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface-muted p-4 text-center text-sm text-fg-muted">
            {t("mapPicker.loadError")}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-fg-subtle">
        {mode === "polygon" ? t("deliveryArea.polygonHint") : t("deliveryArea.circleHint")}
      </p>

      {/* What the manager most needs to know: how far this reaches, and whether
          it is still inside the limit the super admin set. */}
      <p className={cn("text-xs", overLimit ? "font-medium text-red-600" : "text-fg-subtle")} data-testid={`${testId}-reach`}>
        {current
          ? overLimit
            ? t("deliveryArea.overLimit", { reach: fmt.num(reach!.toFixed(2)), max: fmt.num(maxRadiusKm.toFixed(2)) })
            : t("deliveryArea.withinLimit", { reach: fmt.num(reach!.toFixed(2)), max: fmt.num(maxRadiusKm.toFixed(2)) })
          : t("deliveryArea.nothingDrawn")}
      </p>

      <FieldError id={`${testId}-error`} message={error ?? null} />
      {/* The stored JSON travels with the form, so a no-JS submit still carries
          whatever was drawn. */}
      <input type="hidden" name="shape" value={value} />
    </div>
  );
}

/** Add a shape to the map in one of its two forms. */
function drawShape(
  L: Leaflet,
  map: LeafletMap,
  shape: CoverageShape,
  style: { color: string; weight: number; fillOpacity?: number },
): Circle | Polygon {
  if (shape.type === "Circle") {
    return L.circle([shape.coordinates[1], shape.coordinates[0]], {
      radius: shape.radiusKm * 1000,
      ...style,
      interactive: false,
    }).addTo(map);
  }
  return L.polygon(
    shape.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]),
    { ...style, interactive: false },
  ).addTo(map);
}

/** Read-only rendering of one or more areas — the overview and list maps. */
export function ShapeOverview({
  shapes,
  branches = [],
  className,
  heightClass = "h-96",
  testId = "shape-overview",
}: {
  shapes: { id: number; name: string; shape: string | null; isActive: boolean; isHeld: boolean; branchId?: number }[];
  branches?: { id: number; name: string; lat: number | null; lng: number | null }[];
  className?: string;
  heightClass?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { handle, status } = useLeafletMap(containerRef, { center: null, zoom: 11 });
  // Callers pass freshly mapped arrays on every render; keyed on identity, any
  // parent re-render redrew everything and re-framed the view, undoing the
  // admin's own zoom. Keyed on content, and framed once per map.
  const dataKey = JSON.stringify({ shapes, branches });
  const data = useMemo(() => JSON.parse(dataKey) as { shapes: typeof shapes; branches: typeof branches }, [dataKey]);
  const framedRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!handle) return;
    const { L, map } = handle;
    const layers: Layer[] = [];
    const points: { lat: number; lng: number }[] = [];

    for (const branch of data.branches) {
      if (branch.lat == null || branch.lng == null) continue;
      layers.push(
        L.marker([branch.lat, branch.lng], { icon: pinIcon(L, "branch") })
          .bindTooltip(branch.name)
          .addTo(map),
      );
      points.push({ lat: branch.lat, lng: branch.lng });
    }

    for (const area of data.shapes) {
      const parsed = parseShape(area.shape);
      if (!parsed) continue;
      // Held and inactive areas are drawn differently rather than hidden: the
      // whole point of this map is seeing overlaps AND gaps.
      const color = !area.isActive ? "#94a3b8" : area.isHeld ? "#f59e0b" : "#2563eb";
      const layer = drawShape(L, map, parsed, {
        color,
        weight: 2,
        fillOpacity: area.isActive ? 0.15 : 0.06,
      });
      layer.bindTooltip(area.name);
      layers.push(layer);
      if (parsed.type === "Circle") {
        points.push({ lat: parsed.coordinates[1], lng: parsed.coordinates[0] });
      } else {
        for (const [lng, lat] of parsed.coordinates[0]) points.push({ lat, lng });
      }
    }

    if (framedRef.current !== map && points.length > 0) {
      framedRef.current = map;
      fitPoints(map, L, points, 14);
    }
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [handle, data]);

  return (
    <div className={cn("relative", className)} data-testid={testId}>
      <div ref={containerRef} className={cn("w-full rounded-xl border border-border-base", heightClass)} />
      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-surface-muted text-sm text-fg-muted">
          <Spinner className="size-4" /> {t("mapPicker.loading")}
        </div>
      ) : null}
    </div>
  );
}
