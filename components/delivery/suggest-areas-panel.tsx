"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";

export interface SuggestedLocality {
  id: number;
  name: string;
}

interface SuggestedRow extends SuggestedLocality {
  included: boolean;
  charge: string;
  minutes: string;
  window: "both" | "day" | "night";
}

/**
 * ITEM 7 — "Suggest areas for my branch": an ASSISTED starting point, not
 * automatic activation. Pre-fills the master localities in the branch's own
 * location tag (its zone — see the Zone/Area field on the branch form) that it
 * does not already cover, all shown for review. The manager may uncheck, edit
 * (charge / prep time / shift), or delete any suggested row before saving —
 * NOTHING is created until "Save selected areas" is pressed, and only the
 * checked rows are sent, one create call per row (the exact same
 * POST /api/delivery-areas an area created by hand goes through).
 */
export function SuggestAreasPanel({
  zoneId,
  zoneName,
  candidates,
}: {
  /** The branch's own location tag (Branch.zoneId). Null = nothing to suggest. */
  zoneId: number | null;
  zoneName: string | null;
  /** Master localities in that zone the branch does not already cover. */
  candidates: SuggestedLocality[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rows, setRows] = useState<SuggestedRow[]>(() =>
    candidates.map((c) => ({ ...c, included: true, charge: "0", minutes: "45", window: "both" })),
  );

  if (zoneId == null) {
    return (
      <p
        className="rounded-xl border border-dashed border-border-base px-4 py-3 text-sm text-fg-muted"
        data-testid="suggest-areas-no-zone"
      >
        {t("deliveryArea.suggestNoZone")}
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="suggest-areas-open">
        {t("deliveryArea.suggestAreas")}
      </Button>
    );
  }

  function update(id: number, patch: Partial<SuggestedRow>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function remove(id: number) {
    setRows((current) => current.filter((r) => r.id !== id));
  }

  function save() {
    setError(null);
    setNotice(null);
    const selected = rows.filter((r) => r.included);
    if (selected.length === 0) {
      setError(t("deliveryArea.suggestNoneSelected"));
      return;
    }
    startTransition(async () => {
      const failedMessages: string[] = [];
      const failedIds = new Set<number>();
      let saved = 0;
      // Sequential, one create per row — the same call the manual "Add area"
      // form makes — so a single duplicate/validation failure on one locality
      // never blocks the others from saving.
      for (const row of selected) {
        const res = await fetch("/api/delivery-areas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: row.name,
            locality_id: row.id,
            coverage_window: row.window,
            estimated_delivery_minutes: Number(row.minutes) || 45,
            delivery_charge: Number(row.charge) || 0,
          }),
        });
        if (res.ok) {
          saved += 1;
        } else {
          failedIds.add(row.id);
          const payload: unknown = await res.json().catch(() => ({}));
          const parsed = parseFieldErrors(payload, t("common.error"));
          failedMessages.push(`${row.name}: ${parsed.formError ?? Object.values(parsed.fieldErrors)[0] ?? t("common.error")}`);
        }
      }
      if (saved > 0) {
        // Successfully-saved rows drop out of the review list; a failed one
        // stays, unchanged, so the manager can retry it without re-picking.
        setRows((current) => current.filter((r) => failedIds.has(r.id) || !selected.some((s) => s.id === r.id)));
        setNotice(t("deliveryArea.suggestSaved", { count: saved }));
        router.refresh();
      }
      if (failedMessages.length > 0) setError(failedMessages.join(" · "));
      if (saved > 0 && failedMessages.length === 0) setOpen(false);
    });
  }

  return (
    <Card className="mt-4" testId="suggest-areas-panel">
      <CardHeader
        title={t("deliveryArea.suggestTitle", { zone: zoneName ?? "" })}
        subtitle={t("deliveryArea.suggestSubtitle")}
        action={
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
        }
      />
      <CardContent className="space-y-3">
        <Alert tone="error" message={error} />
        {notice ? <p className="text-sm font-medium text-green-600 dark:text-green-400">{notice}</p> : null}
        {rows.length === 0 ? (
          <p className="text-sm text-fg-muted" data-testid="suggest-areas-empty">
            {t("deliveryArea.suggestAllCovered")}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid gap-2 rounded-xl border border-border-base p-3 sm:grid-cols-[auto_1fr_auto_auto_auto_auto] sm:items-center"
                data-testid={`suggest-area-row-${row.id}`}
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.included}
                    onChange={(e) => update(row.id, { included: e.target.checked })}
                    data-testid={`suggest-area-check-${row.id}`}
                  />
                  <span className="font-medium text-fg-base">{row.name}</span>
                </label>
                <span className="hidden sm:block" />
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  className="w-24"
                  aria-label={t("deliveryArea.charge")}
                  value={row.charge}
                  onChange={(e) => update(row.id, { charge: e.target.value })}
                  data-testid={`suggest-area-charge-${row.id}`}
                />
                <Input
                  type="number"
                  min="1"
                  className="w-20"
                  aria-label={t("deliveryArea.minutesShort")}
                  value={row.minutes}
                  onChange={(e) => update(row.id, { minutes: e.target.value })}
                  data-testid={`suggest-area-minutes-${row.id}`}
                />
                <Select
                  aria-label={t("deliveryArea.coverageWindow")}
                  className="w-28"
                  value={row.window}
                  onChange={(e) => update(row.id, { window: e.target.value as SuggestedRow["window"] })}
                  data-testid={`suggest-area-window-${row.id}`}
                >
                  <option value="both">{t("deliveryArea.windowBoth")}</option>
                  <option value="day">{t("deliveryArea.windowDay")}</option>
                  <option value="night">{t("deliveryArea.windowNight")}</option>
                </Select>
                <button
                  type="button"
                  className="justify-self-end text-sm text-red-600 hover:underline"
                  onClick={() => remove(row.id)}
                  data-testid={`suggest-area-remove-${row.id}`}
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 ? (
          <Button onClick={save} disabled={pending} data-testid="suggest-areas-save">
            {pending ? t("common.saving") : t("deliveryArea.suggestSave")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
