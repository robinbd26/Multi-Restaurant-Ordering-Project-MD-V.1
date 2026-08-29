"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/layout/icons";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * WS-6.1 — service-worker registration + push subscription lifecycle.
 *
 * Mounted once from the app shell (app/layout.tsx). It is the only thing in the
 * app that registers /sw.js, and it re-syncs the subscription on every load, so
 * an endpoint the browser silently rotated is repaired without the user doing
 * anything.
 *
 * Permission is NEVER requested on first paint — a cold prompt is the fastest
 * way to get permanently denied, and a denied rider is a rider who misses
 * deliveries. Instead the page is left alone until it is genuinely useful, then
 * a dismissible soft-ask card appears; the browser's own prompt is only reached
 * from the "Turn on" tap. Declining snoozes the card for a week.
 *
 * When push is unconfigured (no VAPID block), the caller is signed out, or the
 * browser has no Push API, this renders nothing and the existing polling +
 * in-app bell carry on exactly as before.
 */

/**
 * Dispatched on `window` once this browser holds a live push subscription.
 * components/rider/assignment-gate.tsx listens for it to back its poll off.
 */
export const PUSH_READY_EVENT = "mad:push-ready";

/** How long a declined soft-ask stays quiet. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "mad_push_snoozed_until";
/** Dwell before the soft-ask — long enough that it never lands on first paint. */
const ASK_AFTER_MS = 12_000;
/** A browser that already granted permission only needs a quiet re-sync. */
const SYNC_AFTER_MS = 2_500;

interface PushStatus {
  enabled: boolean;
  public_key: string | null;
  signed_in: boolean;
}

type Phase = "idle" | "ask" | "blocked" | "failed";

export function PushRegistrar() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dismiss = useCallback(() => {
    snooze();
    setPhase("idle");
  }, []);

  useEffect(() => {
    if (!isSupported()) return;
    // A refusal is a decision — never re-ask, just leave the polling fallback in
    // place. Chrome treats repeat prompting as abuse anyway.
    if (Notification.permission === "denied") return;
    const granted = Notification.permission === "granted";
    if (!granted && isSnoozed()) return;

    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        const status = await loadStatus();
        // No VAPID keys, signed out, or a request that failed — stay invisible.
        if (!alive || !status?.enabled || !status.signed_in || !status.public_key) return;
        setPublicKey(status.public_key);
        if (!granted) {
          setPhase("ask");
          return;
        }
        await subscribeBrowser(status.public_key);
      })();
    }, granted ? SYNC_AFTER_MS : ASK_AFTER_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  async function enable() {
    if (busy || !publicKey) return;
    setBusy(true);
    try {
      // Must be called from the click itself — browsers reject a permission
      // request that is not tied to a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        snooze();
        setPhase(permission === "denied" ? "blocked" : "idle");
        return;
      }
      const ok = await subscribeBrowser(publicKey);
      setPhase(ok ? "idle" : "failed");
    } catch {
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "idle") return null;

  const heading =
    phase === "ask" ? t("notifications.push.title")
      : phase === "blocked" ? t("notifications.push.blockedTitle")
        : t("notifications.push.failedTitle");
  const message =
    phase === "ask" ? t("notifications.push.body")
      : phase === "blocked" ? t("notifications.push.blockedBody")
        : t("notifications.push.failedBody");

  return (
    <section
      aria-label={t("notifications.push.title")}
      data-testid="push-permission-card"
      // Sits above the rider GPS chip (z-40) and below the blocking assignment
      // modal (z-100) — a new-order gate must never be covered by this.
      className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-border-strong bg-surface-card p-4 shadow-2xl sm:left-auto sm:right-3 sm:w-80"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
          <Icon name="bell" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg-base">{heading}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{message}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {phase === "ask" ? (
          <>
            <Button size="sm" className="flex-1" onClick={enable} disabled={busy} data-testid="push-enable">
              {t("notifications.push.enable")}
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={dismiss} disabled={busy}>
              {t("notifications.push.later")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="flex-1" onClick={dismiss}>
            {t("common.close")}
          </Button>
        )}
      </div>
    </section>
  );
}

// ── Browser plumbing ────────────────────────────────────────────────────

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function loadStatus(): Promise<PushStatus | null> {
  try {
    const res = await fetch("/api/push", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PushStatus;
  } catch {
    return null; // offline or a flaky uplink — try again on the next page load
  }
}

/**
 * Register the worker, obtain (or repair) the subscription, and hand it to the
 * server. Returns false on any failure — push is an enhancement, so a failure
 * here must never be louder than a snoozed card.
 */
async function subscribeBrowser(publicKey: string): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      // Always revalidate the worker itself; a stale sw.js cannot be fixed by a
      // deploy, and this file changes rarely enough that the cost is noise.
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;

    const applicationServerKey = decodeKey(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    // A subscription minted against a previous VAPID key can never be pushed to
    // again, and re-subscribing over it throws. Drop it and start clean.
    if (subscription && !matchesKey(subscription, applicationServerKey)) {
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!res.ok) return false;

    window.dispatchEvent(new Event(PUSH_READY_EVENT));
    return true;
  } catch {
    return false;
  }
}

/**
 * VAPID keys travel as URL-safe base64; the Push API wants raw bytes.
 * The `<ArrayBuffer>` argument is required: `applicationServerKey` is a
 * `BufferSource`, which does not accept the default `ArrayBufferLike` view.
 */
function decodeKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const raw = window.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function matchesKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const existing = subscription.options.applicationServerKey;
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  if (bytes.length !== key.length) return false;
  return bytes.every((byte, i) => byte === key[i]);
}

// ── Soft-ask snooze (best-effort; storage may be unavailable) ────────────

function isSnoozed(): boolean {
  try {
    const until = Number(window.localStorage.getItem(SNOOZE_KEY) ?? "0");
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* private mode / storage disabled — the card simply reappears next visit */
  }
}
