"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";
import { integer, min, phone, required } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

const SETTINGS_RULES: FieldRules = {
  prep_time_minutes: [required, integer, min(1)],
  pickup_phone: [phone],
};

export interface DeliverySettings {
  branch_id: number;
  branch_name?: string;
  latitude: string | null;
  longitude: string | null;
  delivery_radius_km: string;
  prep_time_minutes: number;
  pickup_enabled: boolean;
  pickup_address: string;
  pickup_phone: string;
  /** Areas with a shape drawn — 0 means this branch delivers nowhere. */
  drawn_area_count: number;
}

/**
 * The branch manager's delivery settings: preparation time and the pickup point.
 *
 * WHAT IS NOT HERE, on purpose:
 *   · the branch PIN and the MAXIMUM RADIUS — the super admin owns both. The pin
 *     anchors every delivery area and the radius is the ceiling a manager may
 *     draw inside, so a manager moving either would silently redraw their own
 *     limits. Both are shown read-only below.
 *   · COVERAGE — where this branch delivers is the shapes drawn on the Delivery
 *     Areas page. This page used to carry a second, parallel set of coverage
 *     circles; they were migrated into delivery areas and removed, because two
 *     systems deciding the same question is how a customer gets admitted by one
 *     and billed by the other.
 */
export function DeliverySettingsPanel({ settings }: { settings: DeliverySettings }) {
  const { t, fmt } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [prep, setPrep] = useState(String(settings.prep_time_minutes));
  const [pickupEnabled, setPickupEnabled] = useState(settings.pickup_enabled);
  const [pickupAddress, setPickupAddress] = useState(settings.pickup_address);
  const [pickupPhone, setPickupPhone] = useState(settings.pickup_phone);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [submissionId, setSubmissionId] = useState(0);

  const save = useCallback(() => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const response = await fetch("/api/branch-manager/delivery-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prep_time_minutes: prep,
          pickup_enabled: pickupEnabled,
          pickup_address: pickupAddress,
          pickup_phone: pickupPhone,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      setSubmissionId((value) => value + 1);
      if (!response.ok) {
        const parsed = parseFieldErrors(body, t("common.error"));
        setServerErrors(parsed.fieldErrors);
        setError(parsed.formError);
        return;
      }
      setServerErrors({});
      setSaved(true);
      router.refresh();
    });
  }, [pickupAddress, pickupEnabled, pickupPhone, prep, router, t]);

  const { errors, formProps } = useFormValidation(SETTINGS_RULES, {
    onSubmitValid: (event) => {
      event.preventDefault();
      save();
    },
    pending,
    serverErrors,
    serverFormError: error,
    submissionId,
  });

  const hasPin = settings.latitude != null && settings.longitude != null;

  return (
    <form {...formProps} noValidate className="space-y-5">
      <Alert tone="error" message={error} />
      {saved ? <Alert tone="success" message={t("common.saved")} /> : null}

      {/* Read-only coverage facts, so the manager can see what they are drawing
          against without being able to move the goalposts. */}
      <div className="rounded-xl border border-border-base bg-surface-muted p-4 text-sm" data-testid="coverage-facts">
        <p className="font-medium text-fg-base">{t("bmExtras.coverageFactsTitle")}</p>
        <dl className="mt-2 grid gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t("bmExtras.branchPin")}</dt>
            <dd className="text-fg-base">
              {hasPin
                ? t("mapPicker.coordinates", {
                    lat: Number(settings.latitude).toFixed(5),
                    lng: Number(settings.longitude).toFixed(5),
                  })
                : t("bmExtras.branchPinMissing")}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t("bmExtras.maxRadius")}</dt>
            <dd className="text-fg-base">
              {t("branches.radiusN", { km: fmt.num(settings.delivery_radius_km) })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t("bmExtras.drawnAreas")}</dt>
            <dd className={settings.drawn_area_count === 0 ? "font-medium text-amber-600" : "text-fg-base"}>
              {settings.drawn_area_count === 0
                ? t("bmExtras.noDrawnAreas")
                : fmt.num(settings.drawn_area_count)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-fg-subtle">{t("bmExtras.coverageFactsHint")}</p>
        <ButtonLink href="/branch-manager/delivery-areas" variant="outline" size="sm" className="mt-3">
          {t("bmExtras.manageAreas")}
        </ButtonLink>
      </div>

      <Field
        label={t("bmExtras.prepLabel")}
        name="prep_time_minutes"
        hint={t("bmExtras.prepHint")}
        error={errors.prep_time_minutes}
      >
        <Input
          name="prep_time_minutes"
          type="number"
          min="1"
          max={LIMITS.minutesMax}
          value={prep}
          onChange={(event) => setPrep(event.target.value)}
          data-testid="prep-time"
        />
      </Field>

      <div className="space-y-3 rounded-xl border border-border-base p-4">
        <Checkbox
          name="pickup_enabled"
          checked={pickupEnabled}
          onChange={(event) => setPickupEnabled(event.target.checked)}
          label={t("bmExtras.pickupEnabled")}
          data-testid="pickup-enabled"
        />
        <Field label={t("bmExtras.pickupAddress")} name="pickup_address" error={errors.pickup_address}>
          <Input
            name="pickup_address"
            value={pickupAddress}
            onChange={(event) => setPickupAddress(event.target.value)}
            data-testid="pickup-address"
          />
        </Field>
        <Field label={t("bmExtras.pickupPhone")} name="pickup_phone" error={errors.pickup_phone}>
          <Input
            name="pickup_phone"
            value={pickupPhone}
            onChange={(event) => setPickupPhone(event.target.value)}
            placeholder="01XXXXXXXXX"
            data-testid="pickup-phone"
          />
        </Field>
      </div>

      <Button type="submit" disabled={pending} data-testid="save-delivery-settings">
        {pending ? <Spinner className="size-4" /> : null}
        {t("common.save")}
      </Button>
    </form>
  );
}
