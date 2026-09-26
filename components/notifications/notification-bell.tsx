"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/layout/icons";
import { useTranslation } from "@/lib/i18n/use-translation";
import { announce, installSoundUnlock, soundForNotification } from "@/lib/sound";

interface UnreadSummary {
  count: number;
  latest: { id: number; type: string; link: string | null } | null;
}

/**
 * Topbar bell. Polls the unread count so the badge stays fresh without a
 * websocket; clicking it opens the caller's role-scoped notifications inbox.
 *
 * It is also where notifications make a SOUND (lib/sound): when the newest
 * unread notification is one it has not seen before, it plays the tone for
 * that kind of notification — a new order, a delivery offer, a chat message,
 * everything else. The first poll after a page load only records a baseline,
 * so reloading never replays old news. A push that reaches an open tab (the
 * service worker relays it) triggers an immediate re-poll.
 */
export function NotificationBell({ href }: { href: string }) {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const seenId = useRef<number | null>(null);

  useEffect(() => {
    // The bell is on every dashboard page, so it arms the audio unlock even
    // where the sound switch sits in a closed menu (phones).
    installSoundUnlock();
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as UnreadSummary;
        if (!alive) return;
        setCount(data.count ?? 0);
        const latest = data.latest;
        if (seenId.current === null) {
          seenId.current = latest?.id ?? 0; // baseline: nothing is "new" on first paint
        } else if (latest && latest.id > seenId.current) {
          seenId.current = latest.id;
          announce(`notification:${latest.id}`, soundForNotification(latest.type, latest.link), {
            link: latest.link ?? undefined,
            source: "bell",
          });
        }
      } catch {
        /* ignore transient network errors */
      }
    }
    function onPush(event: MessageEvent) {
      if ((event.data as { source?: string } | null)?.source === "mad-push") void load();
    }
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    load();
    const timer = setInterval(load, 30_000);
    navigator.serviceWorker?.addEventListener("message", onPush);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      navigator.serviceWorker?.removeEventListener("message", onPush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    // .icon-btn + .badge from static_design/Branch-manager_dashboard.html
    <Link
      href={href}
      aria-label={t("notifications.title")}
      data-testid="notification-bell"
      className="relative flex size-11 items-center justify-center rounded-full border border-border-base bg-surface-muted text-fg-muted transition hover:bg-surface-hover hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <Icon name="bell" className="size-4.5" />
      {count > 0 ? (
        <span
          data-testid="notification-badge"
          className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full border-2 border-surface-page bg-brand-500 px-1 text-[10px] font-bold text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
