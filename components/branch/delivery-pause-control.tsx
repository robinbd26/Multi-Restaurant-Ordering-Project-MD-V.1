"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

const MODES = ["30m", "1h", "shift", "until_resumed"] as const;

/**
 * "Pause delivery" — the branch manager's short-term brake.
 *
 * PICKUP STAYS OPEN while it runs, which is the whole point: "our riders are
 * swamped" is not "we are closed". Separate from Hold Orders (which stops both
 * rails) and from the super admin's deactivate.
 *
 * A timed pause lifts itself — the server compares the stored end instant to
 * now on every read — so there is nothing to remember to switch back on.
 */
export function DeliveryPauseControl({
  initial,
}: {
  initial: { paused: boolean; mode: string; until: string | null };
}) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState(initial);

  function call(method: "POST" | "DELETE", mode?: string) {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/branch-manager/delivery-pause", {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ mode }) : undefined,
      });
      const body = (await response.json().catch(() => ({}))) as {
        paused?: boolean;
        mode?: string;
        until?: string | null;
      };
      if (!response.ok) {
        setError(parseFieldErrors(body, t("common.error")).formError);
        return;
      }
      setState({ paused: Boolean(body.paused), mode: body.mode ?? "", until: body.until ?? null });
      router.refresh();
    });
  }

  return (
    <Card data-testid="delivery-pause-card">
      <CardHeader
        title={t("branchPause.title")}
        subtitle={t("branchPause.subtitle")}
        action={
          <Badge dot tone={state.paused ? "amber" : "green"} data-testid="delivery-pause-status">
            {state.paused ? t("branchPause.paused") : t("branchPause.running")}
          </Badge>
        }
      />
      <CardContent className="space-y-3">
        <Alert tone="error" message={error} />

        {state.paused ? (
          <>
            <p className="text-sm text-fg-muted" data-testid="delivery-pause-until">
              {state.until
                ? t("branchPause.pausedUntil", { time: fmt.dateTime(state.until) })
                : t("branchPause.pausedIndefinitely")}
            </p>
            <p className="text-sm text-fg-subtle">{t("branchPause.pickupStillOpen")}</p>
            <Button
              type="button"
              variant="success"
              disabled={pending}
              onClick={() => call("DELETE")}
              data-testid="delivery-pause-resume"
            >
              {t("branchPause.resumeNow")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-subtle">{t("branchPause.hint")}</p>
            <div className="flex flex-wrap gap-2">
              {MODES.map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => call("POST", mode)}
                  data-testid={`delivery-pause-${mode}`}
                >
                  {t(`branchPause.mode.${mode}`)}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
