/**
 * Map tile provider, configured from the environment so the provider can be
 * swapped (OSM public server -> a paid/self-hosted tile service) with no code
 * change. Both variables are NEXT_PUBLIC_*: they reach the browser, so they are
 * public by design and must never hold a secret.
 *
 * The public OpenStreetMap tile server has a usage policy and no uptime
 * guarantee; it is the DEFAULT only so development works with zero setup.
 */

export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export interface TileConfig {
  url: string;
  attribution: string;
}

export function tileConfig(): TileConfig {
  // Must stay full static `process.env.NEXT_PUBLIC_*` references: Next inlines
  // them at build time only when it can see the whole expression.
  const url = (process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "").trim();
  const attribution = (process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "").trim();
  return {
    url: url || DEFAULT_TILE_URL,
    // A custom tile URL with no attribution set falls back to OSM's: tiles
    // derived from OSM data legally need it, and an empty credit is never right.
    attribution: attribution || DEFAULT_ATTRIBUTION,
  };
}

/** Dhaka — the frame every map opens on when nothing better is known. */
export const MAP_DEFAULT_CENTER = { lat: 23.8103, lng: 90.4125 } as const;
