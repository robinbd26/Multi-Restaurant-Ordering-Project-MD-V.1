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

/**
 * Give every brand a branch serves an ALL-DAY schedule (00:00 to 00:00, both
 * channels). Since "no hours set" means CLOSED, a branch a spec creates takes
 * no orders until this (or a real schedule) is set. `req` must be a super
 * admin (or that branch's manager). Brands default to every brand the branch
 * serves, read from the hours endpoint.
 */
export async function openBranchAllDay(req: APIRequestContext, branchId: number, slugs?: string[]): Promise<void> {
  let brands = slugs;
  if (!brands) {
    const view = (await (await req.get(`${API_BASE}/api/branches/${branchId}/hours`)).json()) as {
      brands?: { brand: { slug: string } }[];
    };
    brands = (view.brands ?? []).map((b) => b.brand.slug);
  }
  const allDay = { everyDay: [{ start: "00:00", end: "00:00", delivery: true, pickup: true }], days: {} };
  const res = await req.put(`${API_BASE}/api/branches/${branchId}/hours`, {
    data: { brands: Object.fromEntries(brands.map((slug) => [slug, allDay])) },
  });
  if (!res.ok()) throw new Error(`openBranchAllDay(${branchId}) failed: ${res.status()} ${await res.text()}`);
}

/**
 * A fresh, open (all-day hours) single-brand branch centred on `point`, with
 * one orderable product and its ONE delivery area: a circle of `radiusKm`
 * around the branch. Since a branch has exactly one area, tests that hold,
 * edit or block an area use this instead of touching a seeded branch, whose
 * area every other spec depends on. `req` must be a super admin.
 */
export async function freshDeliveryBranch(
  req: APIRequestContext,
  point: { lat: number; lng: number },
  opts: { radiusKm?: number; charge?: number; minutes?: number } = {},
): Promise<{ branch: { id: number; name: string }; product: { id: number }; area: { id: number; name: string } }> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const created = await req.post(`${API_BASE}/api/branches/`, {
    multipart: {
      zone_id: String(await activeZoneId(req)),
      name: `AreaBr-${stamp}`,
      address: "Area Rd, Dhaka",
      phone: `017${Math.floor(10000000 + Math.random() * 89999999)}`,
      brand_type: "cheez",
      latitude: String(point.lat),
      longitude: String(point.lng),
      delivery_radius_km: "5",
      pickup_enabled: "true",
    },
  });
  if (created.status() !== 201) throw new Error(`branch: ${created.status()} ${await created.text()}`);
  const branch = (await created.json()) as { id: number; name: string };
  await openBranchAllDay(req, branch.id);
  const prod = await req.post(`${API_BASE}/api/products/`, {
    multipart: {
      branch_id: String(branch.id),
      name: `AreaP-${stamp}`,
      variation_type: "THICK",
      variations: JSON.stringify([{ name: "Regular", price: 200, isDefault: true, isEnabled: true }]),
    },
  });
  if (prod.status() !== 201) throw new Error(`product: ${prod.status()} ${await prod.text()}`);
  const area = await req.post(`${API_BASE}/api/delivery-areas/`, {
    data: {
      branch_id: branch.id,
      shape: JSON.stringify({ type: "Circle", coordinates: [point.lng, point.lat], radiusKm: opts.radiusKm ?? 2 }),
      delivery_charge: String(opts.charge ?? 60),
      estimated_delivery_minutes: opts.minutes ?? 40,
    },
  });
  if (area.status() !== 201) throw new Error(`area: ${area.status()} ${await area.text()}`);
  return { branch, product: (await prod.json()) as { id: number }, area: (await area.json()) as { id: number; name: string } };
}

/**
 * Archive a branch a spec created, so the persistent test DB does not pile up
 * live fixture branches (they would crowd the customer's branch list and, if
 * they deliver, compete in nearest-branch ranking for other specs).
 */
export async function archiveBranch(req: APIRequestContext, branchId: number): Promise<void> {
  await req.post(`${API_BASE}/api/branches/${branchId}/archive`);
}
