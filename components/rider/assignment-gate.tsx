"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { OrderLocationMap } from "@/components/maps/order-location-map";
import { PUSH_READY_EVENT } from "@/components/notifications/push-registrar";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { announce } from "@/lib/sound";
import { parseFieldErrors } from "@/lib/validation/contract";

/**
 * WS-6.1 — poll cadence. Without push the poll IS the alert, so it stays fast
 * and expensive. With push live the phone is woken by the push service and the
 * service worker pings every open tab (which forces an immediate poll below),
 * so the timer drops to a safety net — a real saving on a prepaid 3G plan and
 * on a battery that has to last a shift.
 */
const POLL_WITHOUT_PUSH_MS = 5_000;
const POLL_WITH_PUSH_MS = 30_000;

interface PendingAssignment {
  /** The offer itself (one per assignment attempt), so a re-offer rings again. */
  id: number;
  order: number;
  order_number: string | null;
  delivery_address: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  distance_km: number | null;
}

/**
 * Rider new-order blocking gate (req #6). Polls pending assignments every 5s
 * (the project's existing polling model — no extra WebSocket stack) and, when
 * one exists, shows a BLOCKING modal that cannot be dismissed by outside-click
 * or Escape. The rider must Accept or Reject (reason required) before using the
 * rest of the dashboard. The shared alert tone (lib/sound) plays when audio is permitted;
 * visual alerting continues regardless. Focus is trapped inside the dialog.
 * Duplicate/stale offers are handled server-side (pending endpoint filters
 * superseded/reassigned offers), so the modal never acts on a stale order.
 *
 * WS-6.1 — the poll is now the FALLBACK, not the only channel. A locked screen
 * cannot poll at all, so web push is what actually reaches the rider between
 * deliveries; when a subscription is live the interval relaxes (see the
 * constants above) and a push instead triggers an immediate poll. If push is
 * unconfigured, unsupported or denied, this behaves exactly as it always did.
 */
export function RiderAssignmentGate() {
  const { t } = useTranslation();
  const router = useRouter();
  const [queue, setQueue] = useState<PendingAssignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pushActive, setPushActive] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const current = queue[0] ?? null;

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/rider/assignments/pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { results: PendingAssignment[] };
      setQueue(data.results ?? []);
    } catch {
      /* transient network error — keep last state, retry next tick */
    }
  }, []);

  useEffect(() => {
    // Defer the first poll out of the effect body (avoids sync setState-in-effect).
    const first = setTimeout(poll, 0);
    const id = setInterval(poll, pushActive ? POLL_WITH_PUSH_MS : POLL_WITHOUT_PUSH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [poll, pushActive]);

  /**
   * Is this browser actually subscribed to push? Only then is it safe to slow
   * the poll down. Re-checked when the registrar announces a fresh subscription,
   * because it may finish after this component has already mounted.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) {
      return;
    }
    let alive = true;
    async function detect() {
      let subscribed = false;
      if (Notification.permission === "granted") {
        try {
          // getRegistration() resolves undefined when no worker is installed —
          // unlike serviceWorker.ready, which would simply never settle.
          const registration = await navigator.serviceWorker.getRegistration();
          subscribed = Boolean(await registration?.pushManager.getSubscription());
        } catch {
          subscribed = false; // any failure counts as "no push"
        }
      }
      // Always writes the resolved answer: permission revoked mid-session has to
      // put the fast poll back, or the rider silently stops being alerted.
      if (alive) setPushActive(subscribed);
    }
    function recheck() {
      if (document.visibilityState === "visible") void detect();
    }
    void detect();
    window.addEventListener(PUSH_READY_EVENT, detect);
    // Coming back to the tab is the moment a permission the rider just revoked
    // (or granted) in browser settings becomes observable to us.
    document.addEventListener("visibilitychange", recheck);
    return () => {
      alive = false;
      window.removeEventListener(PUSH_READY_EVENT, detect);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  // A push wakes the phone; the service worker forwards it to every open tab so
  // the offer appears at once instead of waiting out the relaxed interval.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      const data = event.data as { source?: string } | null;
      if (data?.source === "mad-push") void poll();
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [poll]);

  // Alert tone + focus when a new offer becomes current. The shared sound
  // system (lib/sound) handles mute and the autoplay unlock; the order's link
  // is passed so the bell, which hears about the same offer, stays quiet.
  useEffect(() => {
    if (!current) return;
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-testid="assignment-accept"]')?.focus();
    announce(`offer:${current.id}`, "alert", { link: `/rider/orders/${current.order}` });
    // Re-run only when the current offer changes (deliberate — not on every poll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.order]);

  // Block Escape while the modal is open; trap focus.
  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (focusables.length) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [current]);

  async function respond(action: "accept" | "reject") {
    if (!current || busy) return;
    // Client validation first — the message lands under the reason input.
    if (action === "reject" && !reason.trim()) {
      setReasonError(t("errors.rider.rejectionReasonRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setReasonError(null);
    try {
      const res = await fetch(`/api/rider/assignments/${current.order}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const { fieldErrors, formError } = parseFieldErrors(data, t("common.error"));
        // A rejection-reason complaint belongs under that field, not in a banner.
        setReasonError(fieldErrors.reason ?? null);
        setError(fieldErrors.reason ? null : formError);
        return; // the typed reason is kept so it can be corrected
      }
      setRejecting(false);
      setReason("");
      setQueue((q) => q.slice(1)); // drop the resolved offer; poll reconciles
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="assignment-title"
      data-testid="rider-assignment-modal"
    >
      <div ref={dialogRef} className="w-full max-w-md rounded-2xl border border-border-strong bg-surface-card p-5 shadow-2xl">
        <h2 id="assignment-title" className="text-lg font-extrabold text-fg-base">
          {t("assignment.newOrderTitle")}
        </h2>
        <p className="mt-1 break-all font-mono text-sm font-bold text-brand-500">{current.order_number ?? `#${current.order}`}</p>

        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("assignment.deliveryTo")}</dt>
            <dd className="break-words text-fg-base">{current.delivery_address}</dd>
          </div>
          {current.distance_km != null ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("assignment.distance")}</dt>
              <dd className="text-fg-base">{current.distance_km} km</dd>
            </div>
          ) : null}
        </dl>

        {current.delivery_lat != null && current.delivery_lng != null ? (
          <OrderLocationMap className="mt-3" lat={current.delivery_lat} lng={current.delivery_lng} testId="assignment-map" />
        ) : (
          <div className="mt-3 flex h-24 items-center justify-center rounded-xl border border-border-base bg-surface-muted text-xs text-fg-muted">
            {t("assignment.mapUnavailable")}
          </div>
        )}

        {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}

        {rejecting ? (
          <div className="mt-3">
            <label htmlFor="assignment-reject-reason" className="mb-1 block text-sm font-medium text-fg-base">
              {t("assignment.rejectReason")}
              <span className="text-brand-500" aria-hidden="true"> *</span>
            </label>
            <Input
              id="assignment-reject-reason"
              name="reason"
              autoFocus
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              aria-invalid={Boolean(reasonError)}
              aria-describedby={reasonError ? "assignment-reject-reason-error" : undefined}
              placeholder={t("assignment.rejectReasonPlaceholder")}
            />
            <FieldError id="assignment-reject-reason-error" message={reasonError} />
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRejecting(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => respond("reject")} disabled={busy}>
                {t("assignment.confirmReject")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-2">
            <Button variant="success" className="flex-1" onClick={() => respond("accept")} disabled={busy} data-testid="assignment-accept">
              {t("assignment.accept")}
            </Button>
            <Button variant="outline" className="flex-1 text-red-600" onClick={() => setRejecting(true)} disabled={busy} data-testid="assignment-reject">
              {t("assignment.reject")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
