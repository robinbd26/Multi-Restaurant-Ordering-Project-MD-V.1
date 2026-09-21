"use client";

import { useEffect, useState } from "react";

import {
  browserGeolocationPermission,
  useLocationConsent,
} from "@/lib/hooks/use-location-consent";
import { useTranslation } from "@/lib/i18n/use-translation";

/**
 * The site's own "may we use your location?" card, shown before the browser's.
 *
 * Browsers will not let a page force the native prompt, and one that already
 * holds a denial never shows it again — so this card explains the ask first and
 * the real geolocation request only happens after "Accept". Everything else
 * falls back the way a plain permission failure already does: the saved default
 * address, or picking one by hand in "Deliver to".
 *
 *  - Not answered yet + browser has not blocked it → the card.
 *  - Accept → the shared live-location flow (`onAccept`). If the browser reports
 *    a prior denial, nothing can be prompted, so the fallback note shows instead.
 *  - Reject → remembered; the fallback note shows once and the card never returns.
 *  - Browser already denied → no card at all (it could not do anything).
 */
export function LocationConsentCard({
  onAccept,
  busy,
}: {
  /** Starts the shared live-location request (the native prompt). */
  onAccept: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { consent, accept, reject } = useLocationConsent();
  const [browserBlocked, setBrowserBlocked] = useState(false);
  // What to say after an answer, this session only: null while the card is up.
  const [outcome, setOutcome] = useState<"rejected" | "blocked" | null>(null);

  // A prior denial on record → the native prompt cannot be re-triggered from
  // script, so asking would be a dead end. Read once on mount.
  useEffect(() => {
    let live = true;
    void browserGeolocationPermission().then((state) => {
      if (live) setBrowserBlocked(state === "denied");
    });
    return () => {
      live = false;
    };
  }, []);

  async function handleAccept() {
    accept();
    if ((await browserGeolocationPermission()) === "denied") {
      setOutcome("blocked");
      return;
    }
    onAccept();
  }

  function handleReject() {
    reject();
    setOutcome("rejected");
  }

  if (outcome) {
    return (
      <p
        className="mx-auto mt-2 max-w-300 rounded-lg border border-white/10 bg-[#1c1c24] px-3 py-2 text-[0.78rem] text-[#c8c8d4]"
        role="status"
        data-testid="location-consent-fallback"
      >
        {outcome === "blocked" ? t("location.consentBlockedNote") : t("location.consentRejectedNote")}
      </p>
    );
  }

  if (consent !== "unknown" || browserBlocked) return null;

  return (
    <div
      className="mx-auto mt-2 flex max-w-300 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/12 bg-[#1c1c24] px-4 py-3"
      role="region"
      aria-label={t("location.consentTitle")}
      data-testid="location-consent-card"
    >
      <span aria-hidden className="text-lg">
        📍
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.85rem] font-bold text-white">{t("location.consentTitle")}</p>
        <p className="text-[0.78rem] text-[#a0a0b0]">{t("location.consentBody")}</p>
      </div>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleReject}
          disabled={busy}
          data-testid="location-consent-reject"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-[0.78rem] font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/5 disabled:opacity-60"
        >
          {t("location.consentReject")}
        </button>
        <button
          type="button"
          onClick={() => void handleAccept()}
          disabled={busy}
          data-testid="location-consent-accept"
          className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-[0.78rem] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {t("location.consentAccept")}
        </button>
      </span>
    </div>
  );
}
