import "server-only";

import { cookies } from "next/headers";

import { BROWSE_SCOPE_COOKIE, parseBrowseScope, type BrowseScope } from "./config";

/**
 * Read the customer's browse scope from the cookie (server components).
 *
 * Mirrors getLocale()/getThemePreference(): one cookie read, normalised through
 * the shared parser, never throwing. The ids it returns are UNVALIDATED — the
 * resolver in lib/services/customer-branch.ts owns ownership and liveness checks.
 */
export async function readBrowseScope(): Promise<BrowseScope> {
  const store = await cookies();
  return parseBrowseScope(store.get(BROWSE_SCOPE_COOKIE)?.value);
}
