"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * WS-4.4 — "Out of Delivery Zone", but with somewhere to go.
 *
 * The requirement explicitly asks the out-of-zone state to name the nearest
 * pickup point, and `nearestPickupBranch` has resolved exactly that server-side
 * all along — it was only ever surfaced inside the checkout coverage response,
 * so a customer who never reached checkout was told "we cannot deliver here" and
 * nothing else. This is that missing half: the branch's name, how far away it
 * is, its pickup address and phone, its hours, and a Google Maps route link.
 *
 * It fetches only when it is RENDERED, which is only in an out-of-zone state, so
 * a customer who is inside a coverage area never pays for this request. The
 * coordinates stay on the server: the endpoint reads the customer's own trusted
 * point and this component never sends one.
 *
 * `tone` exists because the two call sites live in different skins — the amber
 * dashboard banner on /customer/branches and the dark storefront strip on the
 * homepage — and a second component for the same data would be the duplication
 * this pass is meant to remove.
 */

interface Pickup {
  branch_id: number;
  branch_name: string;
  address: string;
  phone: string;
  distance_km: number | null;
  opening_time: string | null;
  closing_time: string | null;
  directions_url: string | null;
}

type Phase = "loading" | "ready" | "empty";

export function NearestPickupCallout({
  tone = "light",
  className,
  testId = "nearest-pickup",
}: {
  tone?: "light" | "dark";
  className?: string;
  testId?: string;
}) {
  const { t, fmt } = useTranslation();
  const [pickup, setPickup] = useState<Pickup | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/delivery/nearest-pickup", { cache: "no-store" });
        if (!res.ok) {
          if (alive) setPhase("empty");
          return;
        }
        const data = (await res.json()) as { pickup: Pickup | null };
        if (!alive) return;
        setPickup(data.pickup);
        setPhase(data.pickup ? "ready" : "empty");
      } catch {
        // A pickup suggestion is a courtesy on top of an already-honest banner;
        // a failed lookup must never turn into an error the customer must clear.
        if (alive) setPhase("empty");
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const dark = tone === "dark";
  const link = cn(
    "inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-[0.78rem] font-semibold transition-colors",
    dark
      ? "border border-white/15 text-white hover:border-brand-500 hover:bg-white/5"
      : "border border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10",
  );

  if (phase === "loading") {
    return (
      <p
        className={cn("text-xs", dark ? "text-[#a0a0b0]" : "text-amber-700 dark:text-amber-300", className)}
        role="status"
        aria-live="polite"
        data-testid={`${testId}-loading`}
      >
        {t("outOfZone.pickupFinding")}
      </p>
    );
  }

  if (phase === "empty" || !pickup) {
    return (
      <p
        className={cn("text-xs", dark ? "text-[#a0a0b0]" : "text-amber-700 dark:text-amber-300", className)}
        data-testid={`${testId}-none`}
      >
        {t("outOfZone.pickupNone")}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2.5",
        dark ? "border border-white/10 bg-white/5" : "border border-amber-300 bg-amber-100/60 dark:border-amber-500/30 dark:bg-amber-500/10",
        className,
      )}
      data-testid={testId}
    >
      <p className={cn("text-sm font-semibold", dark ? "text-white" : "text-amber-900 dark:text-amber-100")}>
        {t("outOfZone.pickupTitle")}
      </p>
      <p className={cn("mt-0.5 text-sm", dark ? "text-[#d5d5de]" : "text-amber-800 dark:text-amber-200")} data-testid={`${testId}-branch`}>
        {t("outOfZone.pickupBody", { branch: pickup.branch_name })}
      </p>
      <p className={cn("mt-0.5 text-xs", dark ? "text-[#a0a0b0]" : "text-amber-700 dark:text-amber-300")}>📍 {pickup.address}</p>
      <p className={cn("mt-0.5 flex flex-wrap gap-x-3 text-xs", dark ? "text-[#a0a0b0]" : "text-amber-700 dark:text-amber-300")}>
        {pickup.distance_km != null ? (
          <span data-testid={`${testId}-distance`}>{t("outOfZone.pickupDistance", { km: fmt.num(pickup.distance_km) })}</span>
        ) : null}
        {pickup.opening_time && pickup.closing_time ? (
          <span>🕒 {t("outOfZone.pickupHours", { from: fmt.clock(pickup.opening_time), to: fmt.clock(pickup.closing_time) })}</span>
        ) : null}
      </p>
      <span className="mt-2 flex flex-wrap gap-2">
        {pickup.directions_url ? (
          <a
            className={link}
            href={pickup.directions_url}
            target="_blank"
            rel="noreferrer"
            data-testid={`${testId}-directions`}
          >
            {t("outOfZone.pickupDirections")}
          </a>
        ) : null}
        {pickup.phone ? (
          <a className={link} href={`tel:${pickup.phone}`} data-testid={`${testId}-call`}>
            {t("outOfZone.pickupCall", { phone: pickup.phone })}
          </a>
        ) : null}
      </span>
    </div>
  );
}
