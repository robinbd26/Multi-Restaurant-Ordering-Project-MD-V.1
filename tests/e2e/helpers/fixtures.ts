import type { APIRequestContext } from "@playwright/test";

import { API_BASE } from "./routes";

/**
 * The hardcoded 03:45–04:00 night-delivery blackout no longer exists: ordering
 * hours are each brand's own schedule at its branch (lib/hours/availability),
 * and the e2e seed leaves the demo branches' schedules unset (no time limit),
 * as are branches the specs create. Kept, always false, so the specs that used
 * to skip themselves inside the window still compile and simply run.
 */
export function inNightOrderBlackout(_now: Date = new Date()): boolean {
  void _now;
  return false;
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
 * The hardcoded 04:00–11:00 platform closure no longer exists (see above);
 * schedules are per brand now and tested in 74-brand-hours.spec.ts. Always
 * false, kept so existing specs compile and run at any hour.
 */
export function isDhakaFullClosureWindow(_now: Date = new Date()): boolean {
  void _now;
  return false;
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

/**
 * A delivery order of the branch manager's branch that a rider may be assigned
 * to: accepted, preparing or ready (Part 3: never before the branch accepts,
 * never after pickup). A pending delivery order is accepted first. Throws when
 * the branch has neither, so a spec never silently assigns to a wrong order.
 */
export async function assignableOrderId(bmReq: APIRequestContext): Promise<number> {
  const res = await bmReq.get(`${API_BASE}/api/orders/?page_size=100`);
  const rows = ((await res.json()) as { results?: { id: number; status: string; fulfillment_type?: string }[] }).results ?? [];
  const delivery = rows.filter((o) => o.fulfillment_type !== "pickup");
  const ready = delivery.find((o) => ["accepted", "preparing", "ready"].includes(o.status));
  if (ready) return ready.id;
  const pending = delivery.find((o) => o.status === "pending");
  if (!pending) throw new Error("no pending or accepted delivery order on the branch manager's branch");
  const accepted = await bmReq.post(`${API_BASE}/api/orders/${pending.id}/update-status/`, { data: { status: "accepted" } });
  if (!accepted.ok()) throw new Error(`could not accept order ${pending.id}: ${accepted.status()}`);
  return pending.id;
}
