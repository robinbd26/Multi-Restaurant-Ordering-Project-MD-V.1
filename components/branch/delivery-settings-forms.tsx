"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { saveDeliverySettingsAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import type { FieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";
import {
  max,
  min,
  number,
  range,
  required,
} from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

const ZONE_RULES: FieldRules = {
  delivery_radius_km: [required, number, min(LIMITS.radiusMin), max(LIMITS.radiusMax)],
  latitude: [number, range(LIMITS.latMin, LIMITS.latMax)],
  longitude: [number, range(LIMITS.lngMin, LIMITS.lngMax)],
};

export function DeliveryZoneForm({
  radius,
  latitude,
  longitude,
}: {
  radius: string;
  latitude: string | null;
  longitude: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState(radius);
  const [lat, setLat] = useState(latitude ?? "");
  const [lng, setLng] = useState(longitude ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  /** Coordinates are optional but must be supplied as a PAIR. */
  const validateCoords = useCallback((): FieldErrors => {
    if (lat.trim() && !lng.trim()) return { longitude: t("addresses.errCoordPair") };
    if (lng.trim() && !lat.trim()) return { latitude: t("addresses.errCoordPair") };
    return {};
  }, [lat, lng, t]);

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
      start(async () => {
        const res = await saveDeliverySettingsAction({
          delivery_radius_km: r,
          latitude: lat || undefined,
          longitude: lng || undefined,
        });
        setSubmissionId((n) => n + 1);
        setServerErrors(res.fieldErrors ?? {});
        if (res.error || Object.keys(res.fieldErrors ?? {}).length > 0) {
          setError(res.error);
          return;
        }
        setSuccess(res.success ?? null);
        router.refresh();
      });
    },
    [lat, lng, r, router],
  );

  const { errors, formProps } = useFormValidation(ZONE_RULES, {
    validate: validateCoords,
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending,
  });

  return (
    <form {...formProps} className="space-y-4">
      <Alert tone="error" message={error} />
      {Object.keys(errors).length === 0 ? <Alert tone="success" message={success} /> : null}
      <Field
        label={t("bmExtras.radiusLabel")}
        name="delivery_radius_km"
        required
        error={errors.delivery_radius_km}
      >
        <Input name="delivery_radius_km" inputMode="decimal" value={r} onChange={(e) => setR(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("bmExtras.latLabel")} name="latitude" error={errors.latitude}>
          <Input name="latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="23.8103" />
        </Field>
        <Field label={t("bmExtras.lngLabel")} name="longitude" error={errors.longitude}>
          <Input name="longitude" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="90.4125" />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t("common.saving") : t("common.save")}</Button>
    </form>
  );
}
