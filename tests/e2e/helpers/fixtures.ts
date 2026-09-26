import type { APIRequestContext } from "@playwright/test";

import { API_BASE } from "./routes";

/**
 * PHASE 3 — 03:45 to 04:00 Dhaka time: the night shift takes no NEW delivery
 * order, so the ride can finish by four. That is a real product rule, and for
 * those fifteen minutes a delivery quote or order is refused on purpose.
 *
 * Specs that place delivery orders skip themselves inside the window rather than
 * reporting the rule as a failure. Computed the same way the server computes it
 * (lib/services/coverage-window.ts), from Dhaka wall-clock time.
 */
export function inNightOrderBlackout(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = hh * 60 + mm;
  return minutes >= 3 * 60 + 45 && minutes < 4 * 60;
}

export const NIGHT_BLACKOUT_REASON =
  "03:45–04:00 Dhaka: the night shift accepts no new delivery order (by design)";

/**
 * Delete every saved address this customer has.
 *
 * A customer may hold only five, and the test database PERSISTS across specs, so
 * a spec that leaves addresses behind silently breaks the next one that tries to
 * add one. Any spec that creates addresses calls this first.
 */
export async function clearCustomerAddresses(
  req: APIRequestContext,
  match?: RegExp,
): Promise<void> {
  const res = await req.get(`${API_BASE}/api/customer/addresses/?page_size=100`);
  if (res.status() !== 200) return;
  const payload = (await res.json()) as { results?: { id: number; address?: string }[] };
  for (const row of payload.results ?? []) {
    // With a marker, delete only the rows THIS spec wrote: the seeded customer
    // is shared, and specs run in parallel workers.
    if (match && !(typeof row.address === "string" && match.test(row.address))) continue;
    await req.delete(`${API_BASE}/api/customer/addresses/${row.id}/`);
  }
}

/**
 * ITEM 5 — 04:00–11:00 Dhaka: the whole platform is closed, delivery and
 * pickup alike, at every branch. Mirrors isFullClosureWindow in
 * lib/services/coverage-window.ts, computed independently (not imported) the
 * same way inNightOrderBlackout above does, so this file has no dependency on
 * server code and keeps working if that module ever moves.
 */
export function isDhakaFullClosureWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = hh * 60 + mm;
  return minutes >= 4 * 60 && minutes < 11 * 60;
}

export const FULL_CLOSURE_REASON = "04:00–11:00 Dhaka: the whole platform is closed (by design)";
export const NOT_CLOSED_REASON = "outside 04:00–11:00 Dhaka: the full-closure window is not active";

/**
 * An ACTIVE delivery zone's id. Creating a branch requires a zone (ITEM 7:
 * Branch.zone is a required relation), so every spec that creates branches
 * must pass one. Super admin session required.
 */
export async function activeZoneId(req: APIRequestContext): Promise<number> {
  const res = await req.get(`${API_BASE}/api/area-zones`);
  if (!res.ok()) throw new Error(`area-zones → ${res.status()}`);
  const zones = (await res.json()).results as { id: number; isActive: boolean }[];
  const zone = zones.find((z) => z.isActive);
  if (!zone) throw new Error("no active delivery zone in this database");
  return zone.id;
}

/**
 * The seeded branches specs look up by name. They are the OLDEST rows, and
 * /api/branches lists newest first, so in a long-lived test.db (hundreds of
 * test-made branches) they fall off any fixed page. Always found by search.
 */
const SEEDED_BRANCH_NAMES = ["Main Branch", "Cheez Gulshan"] as const;

export interface BranchRow {
  id: number;
  name: string;
  brand_type: string;
}

/** One branch by its exact name, via the API's search (not a page scan). */
export async function branchIdByName(req: APIRequestContext, name: string): Promise<number> {
  const res = await req.get(`${API_BASE}/api/branches/?search=${encodeURIComponent(name)}&page_size=100`);
  if (!res.ok()) throw new Error(`branch search "${name}" → ${res.status()}`);
  const row = ((await res.json()).results as BranchRow[]).find((b) => b.name === name);
  if (!row) throw new Error(`no branch named "${name}" in this database`);
  return row.id;
}

/**
 * name → row for the newest branches PLUS every seeded branch, found by name
 * wherever it sits. Specs that need "some other branch" read the recent rows;
 * specs that need Main Branch or Cheez Gulshan always get them.
 */
export async function branchRowsByName(req: APIRequestContext): Promise<Record<string, BranchRow>> {
  const map: Record<string, BranchRow> = {};
  const recent = await req.get(`${API_BASE}/api/branches/?page_size=100`);
  if (!recent.ok()) throw new Error(`branch list → ${recent.status()}`);
  for (const b of (await recent.json()).results as BranchRow[]) map[b.name] = b;
  for (const name of SEEDED_BRANCH_NAMES) {
    if (map[name]) continue;
    const res = await req.get(`${API_BASE}/api/branches/?search=${encodeURIComponent(name)}&page_size=100`);
    if (!res.ok()) continue;
    const row = ((await res.json()).results as BranchRow[]).find((b) => b.name === name);
    if (row) map[name] = row;
  }
  return map;
}

/** name → id, as branchRowsByName (seeded branches always included). */
export async function branchMap(req: APIRequestContext): Promise<Record<string, number>> {
  const rows = await branchRowsByName(req);
  return Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row.id]));
}
