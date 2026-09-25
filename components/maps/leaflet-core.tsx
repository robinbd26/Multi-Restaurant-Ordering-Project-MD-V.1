"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useState, type RefObject } from "react";
import type * as LeafletNS from "leaflet";

import { MAP_DEFAULT_CENTER, tileConfig } from "./map-config";

/**
 * Shared Leaflet plumbing.
 *
 * SSR: `leaflet` touches `window` the moment it is imported, so it is NEVER
 * imported at module top level. `loadLeaflet()` pulls it in with a dynamic
 * import from inside an effect, which only ever runs in the browser. The CSS
 * import above is harmless on the server. Every map component in this folder
 * goes through `useLeafletMap`, so none of them can accidentally break
 * server rendering.
 *
 * 3G: the library (~150 KB) is a separate chunk fetched on first map mount,
 * never part of the initial page load.
 */

export type Leaflet = typeof LeafletNS;
export type LeafletMap = LeafletNS.Map;

let leafletPromise: Promise<Leaflet> | null = null;

export function loadLeaflet(): Promise<Leaflet> {
  if (!leafletPromise) {
    leafletPromise = import("leaflet").then((m) => (m as unknown as { default?: Leaflet }).default ?? (m as Leaflet));
    // Let a later mount retry from scratch after a failed chunk load.
    leafletPromise.catch(() => {
      leafletPromise = null;
    });
  }
  return leafletPromise;
}

export interface MapInit {
  center?: { lat: number; lng: number } | null;
  zoom?: number;
  /** false = a display-only map: no drag, zoom or tap handling. */
  interactive?: boolean;
  /**
   * Adds a fullscreen button under the + / − zoom buttons (interactive maps
   * only). Carries its own translated labels because this module has no i18n.
   */
  fullscreen?: { enter: string; exit: string };
}

export type MapHandle = { L: Leaflet; map: LeafletMap } | null;

/**
 * Create a Leaflet map (with the configured tiles + attribution) in the
 * referenced container and destroy it on unmount. Returns null until ready.
 * `status` lets the caller show a spinner or a fallback when the library
 * could not be loaded.
 */
export function useLeafletMap(
  containerRef: RefObject<HTMLDivElement | null>,
  init: MapInit,
  /** Extra dependency: re-run when the container appears (conditional render). */
  mountKey: unknown = true,
): { handle: MapHandle; status: "loading" | "ready" | "error" } {
  const [state, setState] = useState<{ handle: MapHandle; status: "loading" | "ready" | "error" }>({
    handle: null,
    status: "loading",
  });

  // The init object is read once, at creation; later moves are the caller's job.
  const { center, zoom, interactive = true, fullscreen } = init;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !mountKey) return;
    let cancelled = false;
    let created: LeafletNS.Map | null = null;
    let detachFullscreen: (() => void) | null = null;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;
        const c = center ?? MAP_DEFAULT_CENTER;
        const map = L.map(containerRef.current, {
          center: [c.lat, c.lng],
          zoom: zoom ?? (center ? 15 : 12),
          zoomControl: interactive,
          dragging: interactive,
          scrollWheelZoom: false, // never fight the page scroll
          doubleClickZoom: interactive,
          touchZoom: interactive,
          boxZoom: false,
          keyboard: interactive,
          attributionControl: true,
        });
        const tiles = tileConfig();
        L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 19 }).addTo(map);
        if (interactive && fullscreen) detachFullscreen = addFullscreenControl(L, map, fullscreen);
        created = map;
        setState({ handle: { L, map }, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ handle: null, status: "error" });
      });
    return () => {
      cancelled = true;
      detachFullscreen?.();
      created?.remove();
      created = null;
      setState({ handle: null, status: "loading" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, mountKey]);

  return state;
}

export type PinKind = "customer" | "branch" | "rider" | "vertex";

/** Fill colour per pin kind. Vertex handles are drawn separately, below. */
const PIN_COLOR: Record<Exclude<PinKind, "vertex">, string> = {
  customer: "#e11d48",
  branch: "#2563eb",
  rider: "#16a34a",
};

/** `label` is interpolated into the icon's HTML, so it is escaped first. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * A marker icon built from HTML (a DivIcon), so no PNG asset has to be bundled
 * or resolved — Leaflet's default image icons are famously broken by bundlers.
 */
export function pinIcon(L: Leaflet, kind: PinKind, label?: string): LeafletNS.DivIcon {
  if (kind === "vertex") {
    return L.divIcon({
      className: "",
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid #2563eb;box-shadow:0 0 0 1px rgba(0,0,0,.25);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }
  const bg = PIN_COLOR[kind];
  const text = label
    ? `<span style="position:absolute;top:5px;left:0;right:0;text-align:center;color:#fff;font:700 11px/1 sans-serif;">${escapeHtml(label)}</span>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:28px;height:36px;">
      <svg viewBox="0 0 28 36" width="28" height="36" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">
        <path d="M14 0C6.3 0 0 6.2 0 13.8 0 24 14 36 14 36s14-12 14-22.2C28 6.2 21.7 0 14 0z" fill="${bg}"/>
        <circle cx="14" cy="13.5" r="5" fill="#fff"/>
      </svg>${text}</div>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });
}

/** Fit the view to a set of points (with padding); no-op for an empty list. */
export function fitPoints(map: LeafletMap, L: Leaflet, points: { lat: number; lng: number }[], maxZoom = 16) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], Math.min(maxZoom, 15));
    return;
  }
  map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [24, 24], maxZoom });
}

const ENTER_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const EXIT_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

/** Class for the fallback where the Fullscreen API is missing (iPhone Safari). */
const PSEUDO_CLASS = "map-pseudo-fullscreen";

/**
 * A fullscreen toggle, stacked under the zoom buttons in the top-left corner.
 *
 * It is the SAME map element that goes fullscreen, never a second map, so the
 * zoom, the pin and any half-drawn shape are simply still there, in both
 * directions. The browser's Fullscreen API is used when the element supports
 * it; otherwise the container is pinned over the viewport with CSS (Escape or
 * the button leaves). Either way Leaflet is told its size changed, which keeps
 * the centre and zoom and loads tiles for the new area.
 *
 * Returns a detach function for the map's teardown.
 */
function addFullscreenControl(L: Leaflet, map: LeafletMap, labels: { enter: string; exit: string }): () => void {
  const el = map.getContainer();
  let button: HTMLAnchorElement | null = null;

  const isNative = () => typeof document !== "undefined" && document.fullscreenElement === el;
  const isPseudo = () => el.classList.contains(PSEUDO_CLASS);
  const isOn = () => isNative() || isPseudo();

  const sync = () => {
    if (button) {
      const on = isOn();
      button.innerHTML = on ? EXIT_ICON : ENTER_ICON;
      button.title = on ? labels.exit : labels.enter;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(on));
    }
    // After the browser has applied the new size. The default invalidateSize
    // keeps the same centre and zoom.
    requestAnimationFrame(() => map.invalidateSize());
  };

  const setPseudo = (on: boolean) => {
    el.classList.toggle(PSEUDO_CLASS, on);
    // Stop the page behind the map scrolling under the customer's finger.
    document.documentElement.style.overflow = on ? "hidden" : "";
    sync();
  };

  const toggle = () => {
    if (isNative()) {
      void document.exitFullscreen?.().catch(() => {});
    } else if (isPseudo()) {
      setPseudo(false);
    } else if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) {
      el.requestFullscreen().catch(() => setPseudo(true));
    } else {
      setPseudo(true);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isPseudo()) setPseudo(false);
  };

  const Control = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const bar = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      button = L.DomUtil.create("a", "leaflet-control-fullscreen", bar) as HTMLAnchorElement;
      button.href = "#";
      button.setAttribute("role", "button");
      button.dataset.testid = "map-fullscreen";
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(button, "click", (e) => {
        L.DomEvent.preventDefault(e);
        toggle();
      });
      sync();
      return bar;
    },
  });
  const control = new Control();
  control.addTo(map);
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("fullscreenchange", sync);
    document.removeEventListener("keydown", onKey);
    if (isNative()) void document.exitFullscreen?.().catch(() => {});
    if (isPseudo()) {
      el.classList.remove(PSEUDO_CLASS);
      document.documentElement.style.overflow = "";
    }
    control.remove();
    button = null;
  };
}
