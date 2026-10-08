"use client";

import { useActionState, useState } from "react";

import { MapPicker } from "@/components/maps/map-picker";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, FieldGroup, Input, Select, Textarea } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
import { mediaUrl } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { initialActionState } from "@/lib/api/action-state";
import { saveBranchAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { LIMITS } from "@/lib/validation/limits";
import {
  email as emailRule,
  max,
  min,
  number,
  oneOf,
  phone,
  required,
  selectRequired,
} from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";
import { brandName, type BrandInfo } from "@/lib/brands/shared";
import type { Branch } from "@/types";

const BUSINESS_TYPES = ["dine_in", "cloud_kitchen"];

const RULES: FieldRules = {
  name: [required],
  phone: [required, phone],
  business_type: [required, oneOf(BUSINESS_TYPES)],
  zone_id: [selectRequired], // Zone / Area is mandatory — it groups branches for filters and reports
  // The branch PIN anchors every delivery area drawn for this branch, so it is
  // required. Validated here for the message, and again on the server.
  latitude: [required, number, min(-90), max(90)],
  longitude: [required, number, min(-180), max(180)],
  delivery_fee: [number, min(0)],
  address: [required],
  email: [emailRule],
  bkash_number: [phone],
  delivery_radius_km: [required, number, min(LIMITS.radiusMin), max(LIMITS.radiusMax)],
};

const FILES = { logo: false };

/** Full-page create/edit form for a branch (super admin only). */
export function BranchForm({
  branch,
  zones = [],
  brands,
}: {
  branch?: Branch;
  /** Every non-archived brand (assignableBrands), offered as checkboxes. */
  brands: BrandInfo[];
  /** ITEM 7 — the master zone list, for the branch's location-tag field. */
  zones?: { id: number; name: string }[];
}) {
  const { t, locale } = useTranslation();
  // Brands served: a new branch starts with every ACTIVE brand ticked (the old
  // "combined" default); an existing one with exactly what it serves now.
  const [servedBrands, setServedBrands] = useState<string[]>(
    () => branch?.brands ?? brands.filter((b) => b.is_active).map((b) => b.slug),
  );
  // The pin lives in state so the picker and the form's hidden inputs stay in
  // step; the values are plain decimal strings, exactly as the server expects.
  const [pin, setPin] = useState({
    lat: branch?.latitude != null ? String(branch.latitude) : "",
    lng: branch?.longitude != null ? String(branch.longitude) : "",
  });
  const action = saveBranchAction.bind(null, branch?.id ?? null);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const { errors, formProps } = useFormValidation(RULES, {
    files: FILES,
    serverErrors: state.fieldErrors,
    submissionId: state.submissionId,
    pending,
  });

  return (
    <form action={formAction} className="space-y-4" {...formProps}>
      <Alert tone="error" message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("branches.branchName")} required error={errors.name}>
          <Input name="name" required aria-invalid={!!errors.name} defaultValue={branch?.name} placeholder={t("branches.branchNamePlaceholder")} />
        </Field>
        <Field label={t("common.phone")} required hint={t("branches.phoneHint")} error={errors.phone}>
          <Input name="phone" required aria-invalid={!!errors.phone} defaultValue={branch?.phone} placeholder="01XXXXXXXXX" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Which brands this branch serves — one or several. The list is the
            Brand table, so a brand the super admin adds appears here at once.
            Posted as one comma-separated field (repeated form keys collapse). */}
        <Field label={t("branches.brandsServed")} required hint={t("branches.brandsServedHint")} error={errors.brands}>
          <input type="hidden" name="brands" value={servedBrands.join(",")} />
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1.5" data-testid="branch-brands">
            {brands.map((b) => (
              <Checkbox
                key={b.slug}
                label={brandName(b, locale) + (b.is_active ? "" : ` (${t("brands.inactive")})`)}
                value={b.slug}
                checked={servedBrands.includes(b.slug)}
                onChange={(e) =>
                  setServedBrands((cur) =>
                    e.target.checked
                      ? brands.map((x) => x.slug).filter((s) => s === b.slug || cur.includes(s))
                      : cur.filter((s) => s !== b.slug),
                  )
                }
              />
            ))}
          </div>
        </Field>
        {/* Which master zone this branch sits in (Gulshan, Banani, …). A
            GROUPING TAG for filtering and reports — never a coverage grant.
            Where this branch actually delivers is the shapes its manager draws
            on the Delivery Areas page. */}
        <Field label={t("branches.zoneField")} name="zone_id" required hint={t("branches.zoneFieldHint")} error={errors.zone_id}>
          <Select name="zone_id" defaultValue={branch?.zone_id != null ? String(branch.zone_id) : ""} aria-invalid={!!errors.zone_id}>
            <option value="">{t("branches.zoneSelect")}</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Display-only badge for customers — not an order type. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("branches.businessType")}
          name="business_type"
          required
          hint={t("branches.businessTypeHint")}
          error={errors.business_type}
        >
          <Select name="business_type" defaultValue={branch?.business_type ?? "dine_in"}>
            <option value="dine_in">{t("branches.businessTypeDineIn")}</option>
            <option value="cloud_kitchen">{t("branches.businessTypeCloudKitchen")}</option>
          </Select>
        </Field>
      </div>

      <Field label={t("common.address")} name="address" required error={errors.address}>
        <Textarea name="address" required defaultValue={branch?.address} rows={2} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("common.email")} name="email" error={errors.email}>
          <Input name="email" type="email" defaultValue={branch?.email ?? ""} />
        </Field>
        <Field label={t("branches.bkashNumber")} name="bkash_number" error={errors.bkash_number}>
          <Input name="bkash_number" defaultValue={branch?.bkash_number ?? ""} placeholder="01XXXXXXXXX" />
        </Field>
      </div>

      {/* THE BRANCH PIN. Required: every delivery area is drawn around it and
          measured from it, and the "maximum coverage" circle below is centred on
          it, so a branch without a pin can have no coverage at all. Dropped on a
          map rather than typed as decimal degrees. */}
      <MapPicker
        label={t("mapPicker.branchTitle")}
        hint={t("mapPicker.branchHint")}
        lat={pin.lat}
        lng={pin.lng}
        onChange={(point) => setPin({ lat: point.lat, lng: point.lng })}
        latName="latitude"
        lngName="longitude"
        latError={errors.latitude}
        lngError={errors.longitude}
        defaultOpen={!pin.lat || !pin.lng}
        testId="branch-map"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("branches.deliveryRadiusField")}
          hint={t("branches.deliveryRadiusHint")}
          error={errors.delivery_radius_km}
        >
          <Input
            name="delivery_radius_km"
            type="number"
            step="0.1"
            min="0.5"
            aria-invalid={!!errors.delivery_radius_km}
            defaultValue={branch?.delivery_radius_km ?? "3.0"}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Branch-level delivery fee. Free (0) unless priced; a branch manager can
            set it for their own branch, and the super admin can override it here. */}
        <Field label={t("branches.deliveryFeeField")} hint={t("branches.deliveryFeeHint")} error={errors.delivery_fee}>
          <Input
            name="delivery_fee"
            type="number"
            step="0.01"
            min="0"
            aria-invalid={!!errors.delivery_fee}
            defaultValue={branch?.delivery_fee ?? "0"}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Hours are per brand and per channel now, on their own page
            (Branch → Hours), not a single opening/closing pair here. */}
        <div className="rounded-xl border border-dashed border-border-base p-3 text-xs text-fg-muted sm:col-span-2" data-testid="branch-form-hours-note">
          {branch ? (
            <>
              {t("hours.formNoteEdit")}{" "}
              <a className="font-semibold text-brand-600 hover:underline" href={`/admin/branches/${branch.id}/hours`}>
                {t("hours.openEditor")}
              </a>
            </>
          ) : (
            t("hours.formNoteCreate")
          )}
        </div>
        {/* Leaving this empty on edit keeps the branch's current logo. */}
        <FieldGroup
          label={t("branches.logo")}
          name="logo"
          hint={branch?.logo ? t("branches.logoKeepHint") : undefined}
          error={errors.logo}
        >
          <ImageUpload
            name="logo"
            initialPreview={branch?.logo ? mediaUrl(branch.logo) : null}
            testId="upload-branch-logo"
            ariaLabel={t("branches.logo")}
          />
        </FieldGroup>
      </div>

      <input type="hidden" name="is_active" value="false" />
      <Checkbox
        name="is_active"
        value="true"
        label={t("branches.branchActive")}
        defaultChecked={branch?.is_active ?? true}
      />

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
          {branch ? t("common.update") : t("branches.createBranch")}
        </Button>
        <ButtonLink href="/admin/branches" variant="outline">
          {t("common.cancel")}
        </ButtonLink>
      </div>
    </form>
  );
}
