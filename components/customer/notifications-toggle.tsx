"use client";

import { useState, useTransition } from "react";

import { toggleNotificationsAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * On/off switch for the customer's notification preference (server-respected).
 *
 * WS-6.2 — the copy states EXACTLY what the switch does: OFF silences phone
 * (push) alerts for routine order updates and stops marketing entirely; the
 * in-app inbox keeps every row, and payment/security/account notices are always
 * delivered on every channel. The matching server rule lives in
 * lib/services/notifications.ts (OPTIONAL_TYPES / PUSH_OPTIONAL_TYPES).
 */
export function NotificationsToggle({ initial }: { initial: boolean }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(initial);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    start(async () => {
      const res = await toggleNotificationsAction(next);
      if (res.error) setEnabled(!next); // revert on failure
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-fg-base">{t("settings.notifications")}</p>
        <p className="text-xs text-fg-muted">{t("settings.notificationsPushDesc")}</p>
        <p className="mt-0.5 text-xs text-fg-subtle">{t("settings.notificationsAlwaysOn")}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors",
          enabled ? "bg-brand-500" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-6 rounded-full bg-surface-card shadow transition-transform",
            enabled ? "translate-x-5.5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
