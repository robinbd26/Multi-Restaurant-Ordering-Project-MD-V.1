"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { SoundToggle } from "@/components/notifications/sound-toggle";
import { announce } from "@/lib/sound";

/**
 * Branch-manager incoming-order alert. Polls the pending-order count; when it
 * rises, plays the shared "order" tone (lib/sound) and refreshes the list.
 *
 * The sound, its mute switch and the browser's "first tap unlocks audio" rule
 * all live in lib/sound now, so this no longer needs its own enable button:
 * the button here is the app-wide sound switch, shown with a label. The bell
 * hears about the same new order through its notification; both pass the
 * order's link to `announce`, so the manager hears it once.
 */
export function OrderSoundAlert({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const lastCount = useRef(initialCount);

  useEffect(() => {
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/orders?status=pending&page_size=1", { cache: "no-store" });
        if (!res.ok) return;
        // Newest first, so results[0] is the order that just arrived.
        const data = (await res.json()) as { count: number; results?: { id: number }[] };
        if (!alive) return;
        if (data.count > lastCount.current) {
          const newest = data.results?.[0]?.id;
          if (newest) {
            announce(`new-order:${newest}`, "order", { link: `/branch-manager/orders/${newest}` });
          }
          router.refresh();
        }
        lastCount.current = data.count;
      } catch {
        /* ignore */
      }
    }, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [router]);

  return <SoundToggle labelled />;
}
