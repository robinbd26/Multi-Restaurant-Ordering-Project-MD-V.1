"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DeliveryAreaExclusions } from "@/components/delivery/delivery-area-exclusions";
import { PageHeader } from "@/components/layout/page-header";
import { ShapeEditor } from "@/components/maps/shape-editor";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/input";
import type { DeliveryAreaRow } from "@/lib/delivery-areas/query";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors, type FieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";

/** The branch this area is drawn around, and the ceiling it must stay inside. */
export interface DeliveryAreaBranchGeometry {
  id: number;
  name: string;
  /** The branch pin. Null when the super admin has not set one — no drawing. */
  lat: number | null;
  lng: number | null;
  /** Maximum coverage radius in km: no shape may reach past it. */
  maxRadiusKm: number;
  /**
   * Other branches' areas nearby, drawn faintly so overlaps between branches
   * stay visible while drawing (a branch has only one area of its own).
   */
  siblings: { id: number; name: string; shape: string | null }[];
}

/**
 * THE delivery area of one branch, edited on one full-width page.
 *
 * A branch has exactly one area, so there is no name to type and no list to
 * pick from: the map is the area. The terms (charge, time, active) sit under
 * the map, and the temporary blocks (road closed, flooding) below that, because
 * they are laid ON TOP of the area rather than edits of it.
 *
 * Saves go to POST /api/delivery-areas, which creates the branch's area or
 * updates it; the server enforces who may (BM own branch, SA any) and logs it.
 */
export function DeliveryAreaForm({
  geometry,
  initial = null,
  isSuperAdmin,
  backHref,
}: {
  geometry: DeliveryAreaBranchGeometry;
  initial?: DeliveryAreaRow | null;
  isSuperAdmin: boolean;
  /** Where "Back" goes (the super admin's all-branches list); none for a BM. */
  backHref?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [minutes, setMinutes] = useState(String(initial?.estimated_delivery_minutes ?? 45));
  const [charge, setCharge] = useState(initial?.delivery_charge ?? "0");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  // THE SHAPE — the only thing that decides whether a customer's pin is
  // covered. Empty = nothing drawn yet, which covers nobody.
  const [shape, setShape] = useState(initial?.shape ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [holdReason, setHoldReason] = useState("");

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);
    startTransition(async () => {
      const response = await fetch("/api/delivery-areas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branch_id: geometry.id,
          estimated_delivery_minutes: minutes,
          delivery_charge: charge,
          is_active: isActive,
          // One area per branch covers the whole day; opening hours decide
          // when delivery runs.
          coverage_window: "both",
          shape: shape === "" ? null : shape,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const parsed = parseFieldErrors(body, t("common.error"));
        setErrors(parsed.fieldErrors);
        setFormError(parsed.formError);
        return;
      }
      setErrors({});
      setSaved(true);
      const row = body as DeliveryAreaRow;
      // A super admin creating a branch's first area moves to its edit URL, so
      // a reload keeps showing the same area.
      if (isSuperAdmin && !initial) router.replace(`/admin/delivery-areas/${row.id}/edit`);
      else router.refresh();
    });
  }

  function setHold(held: boolean) {
    if (!initial) return;
    setFormError(null);
    startTransition(async () => {
      const response = await fetch(`/api/delivery-areas/${initial.id}/${held ? "hold" : "resume"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(held ? { reason: holdReason.trim() } : {}),
      });
      if (!response.ok) {
        const parsed = parseFieldErrors(await response.json().catch(() => ({})), t("common.error"));
        setFormError(parsed.formError ?? t("common.error"));
        return;
      }
      setHoldReason("");
      router.refresh();
    });
  }

  const center = geometry.lat != null && geometry.lng != null ? { lat: geometry.lat, lng: geometry.lng } : null;
  const fieldError = (key: string) => errors[key] ?? null;

  return (
    <>
      {backHref ? (
        <nav aria-label={t("deliveryArea.breadcrumb")} className="mb-3 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Link className="hover:text-brand-500" href={backHref}>
            {t("deliveryArea.title")}
          </Link>
          <span aria-hidden>›</span>
          <span aria-current="page" className="text-fg-base">
            {geometry.name}
          </span>
        </nav>
      ) : null}

      <PageHeader
        title={t("deliveryArea.editorTitle", { branch: geometry.name })}
        subtitle={t("deliveryArea.editorSub")}
        action={
          backHref ? (
            <ButtonLink href={backHref} variant="outline" className="w-full sm:w-auto">
              {t("deliveryArea.backToAreas")}
            </ButtonLink>
          ) : undefined
        }
      />

      <form onSubmit={save} className="space-y-5" data-testid="delivery-area-editor" noValidate>
        <Alert tone="error" message={formError} />
        {saved ? <Alert tone="success" message={t("deliveryArea.saved")} /> : null}

        <Card>
          <CardHeader
            title={t("deliveryArea.shapeLabel")}
            subtitle={t("deliveryArea.shapeHint")}
            action={
              initial ? (
                <Badge dot tone={!initial.is_active ? "slate" : initial.is_held ? "red" : "green"}>
                  {!initial.is_active
                    ? t("deliveryArea.inactiveBadge")
                    : initial.is_held
                      ? t("deliveryArea.onHold")
                      : t("deliveryArea.available")}
                </Badge>
              ) : (
                <Badge tone="amber">{t("deliveryArea.notCreatedYet")}</Badge>
              )
            }
          />
          <CardContent>
            <ShapeEditor
              value={shape}
              onChange={setShape}
              branchCenter={center}
              maxRadiusKm={geometry.maxRadiusKm}
              siblings={geometry.siblings}
              error={fieldError("shape")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title={t("deliveryArea.formDetails")} />
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t("deliveryArea.minutes")} name="estimated_delivery_minutes" required error={fieldError("estimated_delivery_minutes")}>
                <Input
                  name="estimated_delivery_minutes"
                  type="number"
                  inputMode="numeric"
                  min={LIMITS.minutesMin}
                  max={LIMITS.minutesMax}
                  step={1}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </Field>
              <Field label={t("deliveryArea.charge")} name="delivery_charge" required error={fieldError("delivery_charge")}>
                <Input
                  name="delivery_charge"
                  type="text"
                  inputMode="decimal"
                  value={charge}
                  onChange={(event) => setCharge(event.target.value)}
                />
              </Field>
              <div className="flex items-end pb-2">
                <Checkbox
                  name="is_active"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  label={t("deliveryArea.activeLabel")}
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-border-base pt-5 sm:flex-row sm:justify-end">
              <Button type="submit" disabled={pending || !center} data-testid="delivery-area-save">
                {pending ? t("common.saving") : initial ? t("deliveryArea.saveChanges") : t("deliveryArea.createArea")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {initial ? (
        <div className="mt-5 space-y-5">
          <Card>
            <CardHeader title={t("deliveryArea.deliveryState")} subtitle={t("deliveryArea.holdHint")} />
            <CardContent>
              {initial.is_held ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-fg-base">
                    {t("deliveryArea.heldNow")}
                    {initial.hold_reason ? ` — ${initial.hold_reason}` : ""}
                  </p>
                  <Button type="button" variant="success" disabled={pending} onClick={() => setHold(false)} data-testid="delivery-area-resume">
                    {t("deliveryArea.resumeDelivery")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Field label={t("deliveryArea.holdReasonLabel")} name="hold_reason">
                      <Input
                        name="hold_reason"
                        value={holdReason}
                        onChange={(event) => setHoldReason(event.target.value)}
                        placeholder={t("deliveryArea.holdReasonPlaceholder")}
                        maxLength={200}
                      />
                    </Field>
                  </div>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => setHold(true)} data-testid="delivery-area-hold">
                    {t("deliveryArea.holdDelivery")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {initial.shape && center ? (
            <DeliveryAreaExclusions
              areaId={initial.id}
              areaShape={initial.shape}
              branchCenter={center}
              maxRadiusKm={geometry.maxRadiusKm}
              exclusions={initial.exclusions}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
