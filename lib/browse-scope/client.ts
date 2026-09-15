import { BROWSE_SCOPE_COOKIE, BROWSE_SCOPE_MAX_AGE, formatBrowseScope, type BrowseScope } from "./config";

/**
 * Persist the customer's deliver-to choice, browser-side.
 *
 * Client-only by nature (it touches document.cookie), and kept out of config.ts
 * so the server module can import the shared spelling without pulling in code
 * that would throw if it were ever called during a render.
 *
 * Same cookie attributes as the locale switcher: path=/ so every route sees it,
 * samesite=lax, and a plain max-age. Nothing privileged travels in it — the ids
 * are re-validated server-side on every read.
 */
export function writeBrowseScope(scope: BrowseScope): void {
  document.cookie = `${BROWSE_SCOPE_COOKIE}=${formatBrowseScope(scope)}; path=/; max-age=${BROWSE_SCOPE_MAX_AGE}; samesite=lax`;
}

/** Drop the choice and fall back to the customer's own trusted point. */
export function clearBrowseScope(): void {
  document.cookie = `${BROWSE_SCOPE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
