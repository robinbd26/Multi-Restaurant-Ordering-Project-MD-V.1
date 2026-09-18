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
