/**
 * BROWSE SCOPE — what the storefront customer chose, as TWO independent choices.
 *
 * The homepage catalogue used to be derived from exactly one thing: the branch
 * nearest the customer's trusted coordinates. That conflates two questions the
 * customer asks separately, so the scope carries both, and neither overrides
 * the other:
 *
 *   deliverTo — "where is this order GOING?" The live GPS fix, or one of their
 *       own saved addresses. Drives coverage, the serving branch, the delivery
 *       fee and checkout. Chosen with the "Deliver to" control.
 *   branchId  — "whose menu am I LOOKING at?" Any live branch, or null for "the
 *       branch that serves my deliver-to point". A view lens over the product
 *       grid, the category tabs and the nav search index. Chosen with the
 *       "Browsing" control, and from the dashboard Restaurants page.
 *
 * A customer can hold both at once — deliver to the office, browse Banani —
 * which is exactly why they are two fields and not one union.
 *
 * This module is isomorphic on purpose so the client controls and the server
 * render agree on one spelling of the cookie — the same split the locale
 * preference uses (lib/i18n/config.ts + server.ts).
 *
 * SECURITY — the cookie is NOT httpOnly (the controls write it with
 * document.cookie, exactly like the locale switcher) and it carries nothing
 * privileged. Every id in it is re-validated server-side before use: an address
 * must belong to THIS customer and be active, a branch must be active and not
 * archived. Anything that fails is dropped, so a stale cookie — including one
 * left by a previous account on a shared browser — is inert.
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

export type DeliverTo =
  /** The default: the customer's own trusted point (GPS fix, else default address). */
  | { mode: "gps" }
  /** One of the customer's saved addresses. */
  | { mode: "address"; addressId: number };

export interface BrowseScope {
  deliverTo: DeliverTo;
  /** The branch being browsed; null means "whichever branch serves deliverTo". */
  branchId: number | null;
}

export const DEFAULT_SCOPE: BrowseScope = { deliverTo: { mode: "gps" }, branchId: null };

/** True when nothing is chosen — the cookie can then simply be dropped. */
export function isDefaultScope(scope: BrowseScope): boolean {
  return scope.deliverTo.mode === "gps" && scope.branchId == null;
}

/**
 * Wire form: "|"-joined tokens, "a:<addressId>" and/or "b:<branchId>", or "gps"
 * when neither is set. A single "a:12" or "b:3" — the shape the first release of
 * this cookie wrote — is still a valid value and parses to the same meaning.
 */
export function formatBrowseScope(scope: BrowseScope): string {
  const tokens: string[] = [];
  if (scope.deliverTo.mode === "address") tokens.push(`a:${scope.deliverTo.addressId}`);
  if (scope.branchId != null) tokens.push(`b:${scope.branchId}`);
  return tokens.length > 0 ? tokens.join("|") : "gps";
}

function positiveId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Parse the cookie value. A token that is unrecognised or malformed — a
 * truncated cookie, a negative or non-integer id — is ignored on its own, so a
 * bad branch token never throws away a good address token, and nothing here can
 * break a page render.
 */
export function parseBrowseScope(raw: string | null | undefined): BrowseScope {
  let deliverTo: DeliverTo = { mode: "gps" };
  let branchId: number | null = null;
  for (const token of (raw ?? "").split("|")) {
    const [prefix, rest] = token.split(":", 2);
    const id = positiveId(rest);
    if (id == null) continue;
    if (prefix === "a") deliverTo = { mode: "address", addressId: id };
    else if (prefix === "b") branchId = id;
  }
  return { deliverTo, branchId };
}
