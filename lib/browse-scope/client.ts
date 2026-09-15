import {
  BROWSE_SCOPE_COOKIE,
  BROWSE_SCOPE_MAX_AGE,
  formatBrowseScope,
  isDefaultScope,
  parseBrowseScope,
  type BrowseScope,
} from "./config";

/**
 * Browser-side access to the customer's scope.
 *
 * Client-only by nature (it touches document.cookie), and kept out of config.ts
 * so the server module can import the shared spelling without pulling in code
 * that would throw if it were ever called during a render.
 *
 * Same cookie attributes as the locale switcher: path=/ so every route sees it,
 * samesite=lax, and a plain max-age. Nothing privileged travels in it — the ids
 * are re-validated server-side on every read.
 */

/** The scope as the browser currently holds it (unvalidated — the server decides). */
export function readBrowseScope(): BrowseScope {
  const match = document.cookie.match(new RegExp(`(?:^|;\s*)${BROWSE_SCOPE_COOKIE}=([^;]*)`));
  return parseBrowseScope(match ? decodeURIComponent(match[1]) : null);
}

/** Persist a whole scope; the default scope drops the cookie instead of storing "gps". */
export function writeBrowseScope(scope: BrowseScope): void {
  if (isDefaultScope(scope)) {
    document.cookie = `${BROWSE_SCOPE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  document.cookie = `${BROWSE_SCOPE_COOKIE}=${formatBrowseScope(scope)}; path=/; max-age=${BROWSE_SCOPE_MAX_AGE}; samesite=lax`;
}

/**
 * Change ONE of the two choices and keep the other.
 *
 * The "Deliver to" and "Browsing" controls each own one field. Merging against
 * the cookie — rather than against props — means a control can never clobber
 * the other's choice with a stale copy from the last server render.
 */
export function updateBrowseScope(patch: Partial<BrowseScope>): void {
  writeBrowseScope({ ...readBrowseScope(), ...patch });
}
