"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Icon } from "@/components/layout/icons";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

/**
 * "Hold Orders" — the branch manager's own switch for pausing NEW order intake
 * at their branch, and the matching switch for resuming it.
 *
 * Both directions go through the shared ConfirmModal (the same dialog the order
 * cancel flow uses), so the confirmation and the reason textarea look and
 * behave exactly like every other danger action in the app:
 *   • HOLD    — plain confirmation, no reason. The client asked for exactly
 *               one question here: "Are you sure you want to put this branch
 *               on hold?".
 *   • RELEASE — `withReason`, and the reason is REQUIRED. The requirement is
 *               enforced by the API, not here; a missing reason comes back as
 *               a field error and the dialog shows it next to the textarea
 *               instead of closing (same contract as a reasonless cancel).
 *
 * Nothing here is authorization: the route resolves the manager's own branch
 * server-side and never accepts a branch id from this component.
 */
export function BranchHoldControl({ isOnHold }: { isOnHold: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Held locally only so the button label flips the instant the dialog closes;
  // the authoritative state comes back with the refreshed server render.
  const [held, setHeld] = useState(isOnHold);

  /** POST a hold change; returns the dialog's own error state. */
  const send = useCallback(
    async (url: string, body?: Record<string, unknown>) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // The API answers with a field map ({ hold_release_reason: "…" }) or a
        // form-level detail; either way the dialog needs ONE sentence to show.
        const { fieldErrors, formError } = parseFieldErrors(data, t("errors.generic"));
        return { error: formError ?? Object.values(fieldErrors)[0] ?? t("errors.generic") };
      }
      setHeld(Boolean((data as { is_on_hold?: boolean } | null)?.is_on_hold));
      // Re-render the server page so the banner and the branch status badge
      // agree with the new state instead of drifting from this button.
      startTransition(() => router.refresh());
      return { error: null };
    },
    [router, t],
  );

  if (held) {
    return (
      <ConfirmModal
        trigger={
          <Button variant="success" data-testid="branch-hold-release">
            <Icon name="check" className="size-4" />
            {t("branchHold.resumeOrders")}
          </Button>
        }
        title={t("branchHold.releaseTitle")}
        description={t("branchHold.releaseDesc")}
        confirmLabel={t("branchHold.releaseLabel")}
        // The API REFUSES a reasonless release, so the dialog has to collect one.
        withReason
        reasonPlaceholder={t("branchHold.reasonPlaceholder")}
        action={async (reason) => send("/api/branch-manager/hold/release", { reason })}
      />
    );
  }

  return (
    <ConfirmModal
      trigger={
        <Button variant="outline" className="text-amber-700 dark:text-amber-300" data-testid="branch-hold-start">
          <Icon name="clock" className="size-4" />
          {t("branchHold.holdOrders")}
        </Button>
      }
      title={t("branchHold.confirmTitle")}
      description={t("branchHold.confirmDesc")}
      confirmLabel={t("branchHold.confirmLabel")}
      action={async () => send("/api/branch-manager/hold")}
    />
  );
}
