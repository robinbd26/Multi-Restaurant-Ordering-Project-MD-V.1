"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

/**
 * Per-review staff action. `mode` is decided by the server page from the
 * viewer's role; the API enforces it again (a branch manager posting /hide
 * gets a 403).
 *   - "moderate": Hide (with an optional reason) or Restore — marketing / SA;
 *   - "flag": Flag for marketing (with an optional reason) — branch manager.
 */
export function ReviewModerationActions({
  reviewId,
  mode,
  isHidden,
  flagged,
}: {
  reviewId: number;
  mode: "moderate" | "flag";
  isHidden: boolean;
  flagged: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function call(action: "hide" | "restore" | "flag") {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/reviews/${reviewId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "restore" ? {} : { reason: reason.trim() }),
      });
      if (!res.ok) {
        const parsed = parseFieldErrors(await res.json().catch(() => ({})), t("common.error"));
        setError(parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error"));
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  if (mode === "moderate" && isHidden) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="success" disabled={pending} onClick={() => call("restore")} data-testid={`review-restore-${reviewId}`}>
          {t("reviews.restore")}
        </Button>
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    );
  }
  if (mode === "flag" && flagged) {
    return <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{t("reviews.flaggedForMarketing")}</span>;
  }

  const action = mode === "moderate" ? "hide" : "flag";
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      {open ? (
        <div className="flex w-full flex-col gap-2 sm:w-72">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder={mode === "moderate" ? t("reviews.hideReasonPlaceholder") : t("reviews.flagReasonPlaceholder")}
            aria-label={t("reviews.reasonLabel")}
            data-testid={`review-${action}-reason-${reviewId}`}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant={mode === "moderate" ? "danger" : "primary"} disabled={pending} onClick={() => call(action)} data-testid={`review-${action}-confirm-${reviewId}`}>
              {mode === "moderate" ? t("reviews.hide") : t("reviews.flag")}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`review-${action}-${reviewId}`}>
          {mode === "moderate" ? t("reviews.hide") : t("reviews.flag")}
        </Button>
      )}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
