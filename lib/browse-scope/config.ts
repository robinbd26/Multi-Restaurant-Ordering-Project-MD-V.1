/**
 * BROWSE SCOPE — what the storefront customer chose to look at.
 *
 * The homepage catalogue used to be derived from exactly one thing: the branch
 * nearest the customer's trusted coordinates. That conflates two questions the
 * customer asks separately:
 *
 *   "where is this order GOING?"  → a real, server-validated point (the live GPS
 *       fix, or one of their own saved addresses). Drives coverage, the serving
 *       branch, the delivery fee and checkout.
 *   "whose menu am I LOOKING at?" → a branch, chosen explicitly. A view lens over
 *       the product grid, the category tabs and the nav search index. Nothing more.
 *
 * This module is the transport for that choice. It is isomorphic on purpose so
 * the client picker and the server render agree on one spelling of the cookie —
 * the same split the locale preference uses (lib/i18n/config.ts + server.ts).
 *
 * SECURITY — the cookie is NOT httpOnly (the picker writes it with
 * document.cookie, exactly like the locale switcher) and it carries nothing
 * privileged. Every id in it is re-validated server-side before use: an address
 * must belong to THIS customer and be active, a branch must be active and not
 * archived. Anything that fails degrades silently to "gps", so a stale cookie —
 * including one left by a previous account on a shared browser — is inert.
 *
 * It is a VIEW scope and never an authorisation one: it does not widen what the
 * product APIs return, and it never becomes a delivery decision. A delivery order
 * still resolves its branch server-side from the trusted coordinate
 * (lib/services/orders.ts), with the client's branch_id ignored.
 */

export const BROWSE_SCOPE_COOKIE = "mad_scope";

/**
 * A week. Long enough to survive the trip the feature exists for ("I'll be in
 * Banani at 5pm") and the browser restarts around it, short enough that a
 * forgotten choice does not silently own the catalogue forever.
 */
export const BROWSE_SCOPE_MAX_AGE = 7 * 24 * 60 * 60;

export type BrowseScope =
  /** The default: resolve from the customer's own trusted point. */
  | { mode: "gps" }
  /** Deliver-to is one of the customer's saved addresses. */
  | { mode: "address"; addressId: number }
  /** Browse a specific branch's menu, whether or not it can reach them. */
  | { mode: "branch"; branchId: number };

export const GPS_SCOPE: BrowseScope = { mode: "gps" };

/** Wire form: "gps" | "a:<addressId>" | "b:<branchId>". */
export function formatBrowseScope(scope: BrowseScope): string {
  if (scope.mode === "address") return `a:${scope.addressId}`;
  if (scope.mode === "branch") return `b:${scope.branchId}`;
  return "gps";
}

/**
 * Parse the cookie value. Anything unrecognised — a truncated cookie, a negative
 * or non-integer id, a value from an older release — resolves to "gps" rather
 * than throwing, so a malformed cookie can never break a page render.
 */
export function parseBrowseScope(raw: string | null | undefined): BrowseScope {
  if (!raw) return GPS_SCOPE;
  const [prefix, rest] = raw.split(":", 2);
  if (prefix !== "a" && prefix !== "b") return GPS_SCOPE;
  const id = Number(rest);
  if (!Number.isSafeInteger(id) || id <= 0) return GPS_SCOPE;
  return prefix === "a" ? { mode: "address", addressId: id } : { mode: "branch", branchId: id };
}

/** True when two scopes name the same selection — used to mark the active row. */
export function sameBrowseScope(a: BrowseScope, b: BrowseScope): boolean {
  return formatBrowseScope(a) === formatBrowseScope(b);
}
