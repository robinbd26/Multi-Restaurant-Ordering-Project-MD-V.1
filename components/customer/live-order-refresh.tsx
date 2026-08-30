"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useLiveData } from "@/lib/hooks/use-live-data";

/**
 * WS-5.8 — live customer order tracking, the house way (polling, no sockets).
 *
 * The order pages are server-rendered: the timeline, rider panel, delay notice
 * and payment card are all server components fed by the API. Rather than
 * duplicating that rendering client-side, these refreshers poll a LEAN change
 * fingerprint through the shared `useLiveData` idiom (pauses on hidden tabs,
 * never overlaps requests, keeps the last good snapshot through a blip) and
 * call `router.refresh()` ONLY when the fingerprint moves — the same pattern
 * the branch manager's order-sound-alert uses. The steady-state cost on a
 * prepaid 3G handset is a tiny JSON body per tick; the full re-render happens
 * exactly when the kitchen or the rider actually changed something.
 *
 * They render nothing: the server markup already on screen IS the UI.
 */

/** Matches app/api/orders/[id]/status — the fields worth re-rendering for. */
interface OrderStatusSnapshot {
  status: string;
  payment_status: string;
  rider: number | null;
  updated_at: string;
}

/** Order detail: a customer actively watching dinner move — poll at 12s. */
const DETAIL_REFRESH_MS = 12_000;
/** Orders list: an overview, not a countdown — a gentler 30s is plenty. */
const LIST_REFRESH_MS = 30_000;

function useRefreshOnChange(key: string | null) {
  const router = useRouter();
  // Baseline comes from the SERVER render (passed as `initial` below), so a
  // change that lands between render and the first tick still refreshes.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    if (seen.current === null) {
      seen.current = key;
      return;
    }
    if (seen.current !== key) {
      seen.current = key;
      router.refresh();
    }
  }, [key, router]);
}

/**
 * Mounted by the customer order-detail page while the order can still change
 * (in flight, or a bKash submission awaiting the branch's verdict). Refreshing
 * the route re-renders the status timeline, delay notice, rider panels and
 * payment card from the server in one pass.
 */
export function LiveOrderRefresher({
  orderId,
  initial,
}: {
  orderId: number;
  initial: OrderStatusSnapshot;
}) {
  const { data } = useLiveData<OrderStatusSnapshot>(
    `/api/orders/${orderId}/status`,
    DETAIL_REFRESH_MS,
    initial,
  );
  useRefreshOnChange(
    data ? `${data.status}|${data.payment_status}|${data.rider ?? ""}|${data.updated_at}` : null,
  );
  return null;
}

/** Matches app/api/orders/latest-activity. */
interface OrdersActivitySnapshot {
  count: number;
  latest: string | null;
}

/**
 * Mounted by the customer orders LIST page while any order is still active, so
 * the status chips and summary tiles follow along without a manual reload.
 * No `initial` here — the first tick sets the baseline, which is at worst one
 * redundant comparison, never a missed change (the next tick catches it).
 */
export function LiveOrdersRefresher() {
  const { data } = useLiveData<OrdersActivitySnapshot>(
    "/api/orders/latest-activity",
    LIST_REFRESH_MS,
  );
  useRefreshOnChange(data ? `${data.count}|${data.latest ?? ""}` : null);
  return null;
}
