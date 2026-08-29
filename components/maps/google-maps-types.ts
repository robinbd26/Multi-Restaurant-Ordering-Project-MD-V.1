/**
 * WS-4.1 — the SMALLEST possible type surface for the Google Maps JS SDK.
 *
 * The project ships eight runtime dependencies and no map library (see
 * package.json); `@types/google.maps` is not installed and adding a dependency
 * is out of scope for this change. Rather than reaching for `any`, the handful
 * of SDK members the picker actually touches are declared here structurally.
 * Anything not listed simply cannot be called by mistake.
 */

export interface GLatLng {
  lat(): number;
  lng(): number;
}

export interface GMapMouseEvent {
  latLng: GLatLng | null;
}

export interface GMapsListener {
  remove(): void;
}

export interface GPoint {
  lat: number;
  lng: number;
}

export interface GMap {
  setCenter(position: GPoint): void;
  panTo(position: GPoint): void;
  setZoom(zoom: number): void;
  getZoom(): number | undefined;
  addListener(event: string, handler: (e: GMapMouseEvent) => void): GMapsListener;
}

export interface GMarker {
  setPosition(position: GPoint): void;
  getPosition(): GLatLng | null;
  setMap(map: GMap | null): void;
  addListener(event: string, handler: (e: GMapMouseEvent) => void): GMapsListener;
}

export interface GoogleMapsApi {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => GMap;
  Marker: new (options: Record<string, unknown>) => GMarker;
}

declare global {
  interface Window {
    google?: { maps?: GoogleMapsApi };
    /** Callback the async SDK loader invokes once the API is ready. */
    __madGoogleMapsReady?: () => void;
    /** Google calls this itself when the key is rejected (billing/referrer). */
    gm_authFailure?: () => void;
  }
}
