// Storefront view of "is this brand open right now?", built on the server from
// publicHomeBranches() (whose statuses come from lib/hours/availability on the
// Asia/Dhaka clock). Plain data, safe to hand to client components.

import { earliest } from "@/lib/hours/availability";
import { dhakaMoment } from "@/lib/hours/clock";
import { fromMinutes, type NextOpening } from "@/lib/hours/schedule";
import type { PublicHomeBranch } from "@/lib/selectors";

export interface StorefrontBrandAvailability {
  delivery: boolean;
  pickup: boolean;
  deliveryOpensAt: NextOpening | null;
  pickupOpensAt: NextOpening | null;
}

/**
 * Per brand slug. For one browsed branch it is that branch's own status; for
 * the all-branches view (guests, super admin) a brand counts as open when ANY
 * branch has it open, and its opening is the soonest across branches.
 */
export function storefrontAvailability(
  branches: PublicHomeBranch[],
  branchId: number | null,
): Record<string, StorefrontBrandAvailability> {
  const scope = branchId != null ? branches.filter((b) => b.id === branchId) : branches;
  const out: Record<string, StorefrontBrandAvailability> = {};
  for (const b of scope) {
    for (const s of b.status.brands) {
      const cur = out[s.slug];
      out[s.slug] = cur
        ? {
            delivery: cur.delivery || s.delivery,
            pickup: cur.pickup || s.pickup,
            deliveryOpensAt: earliest([cur.deliveryOpensAt, s.deliveryOpensAt]),
            pickupOpensAt: earliest([cur.pickupOpensAt, s.pickupOpensAt]),
          }
        : {
            delivery: s.delivery,
            pickup: s.pickup,
            deliveryOpensAt: s.deliveryOpensAt,
            pickupOpensAt: s.pickupOpensAt,
          };
    }
  }
  return out;
}

/**
 * Last delivery orders for the countdown: per brand, the LATEST deadline among
 * the scoped branches where its delivery is open right now (a customer can
 * still order until the last one closes).
 */
export function storefrontCutoffs(
  branches: PublicHomeBranch[],
  branchId: number | null,
  now: Date = new Date(),
): { slug: string; deadline: string; time: string }[] {
  const scope = branchId != null ? branches.filter((b) => b.id === branchId) : branches;
  const latest = new Map<string, number>();
  for (const b of scope) {
    for (const s of b.status.brands) {
      if (!s.delivery || s.deliveryClosesIn == null) continue;
      latest.set(s.slug, Math.max(latest.get(s.slug) ?? 0, s.deliveryClosesIn));
    }
  }
  const nowMinutes = dhakaMoment(now).minutes;
  // Deadlines land on a whole minute, like the slot boundaries they come from.
  const minuteStart = now.getTime() - (now.getTime() % 60_000);
  return [...latest.entries()].map(([slug, minutes]) => ({
    slug,
    deadline: new Date(minuteStart + minutes * 60_000).toISOString(),
    time: fromMinutes(nowMinutes + minutes),
  }));
}
