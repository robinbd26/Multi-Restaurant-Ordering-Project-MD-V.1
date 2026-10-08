"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, Input, Select, Textarea } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
import { Spinner } from "@/components/ui/spinner";
import { initialActionState } from "@/lib/api/action-state";
import { updateProfileAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { mediaUrl } from "@/lib/utils";
import { email, notFuture, oneOf, phone, required } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";
import type { User } from "@/types";

const GENDERS = ["male", "female", "other"] as const;

const RULES: FieldRules = {
  first_name: [required],
  last_name: [required],
  email: [required, email],
  phone: [phone],
  date_of_birth: [notFuture],
  gender: [oneOf(["", ...GENDERS])],
};

/** The photo is optional — checked against the same limits the server applies. */
const FILES = { profile_photo: false };

export function ProfileForm({ user }: { user: User }) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initialActionState);
  const { t } = useTranslation();
  // A duplicate email/phone comes back keyed by field and lands under it.
  const { errors, formProps } = useFormValidation(RULES, {
    files: FILES,
    serverErrors: state.fieldErrors,
    submissionId: state.submissionId,
    pending,
  });

  // Show the success alert only when there are no outstanding field errors, so
  // a stale success never renders next to a new validation error.
  const hasFieldErrors = Object.keys(errors).length > 0;

  return (
    <form action={formAction} {...formProps} className="space-y-4">
      <Alert tone="error" message={state.error} />
      {!hasFieldErrors ? <Alert tone="success" message={state.success} /> : null}

      {/* The shared upload field: the current photo is the preview until a new
          one is picked; the hook still validates the named input against the
          same MIME/size limits as the server. */}
      <FieldGroup label={t("profile.profilePhoto")} name="profile_photo" error={errors.profile_photo}>
        <ImageUpload
          name="profile_photo"
          variant="avatar"
          initialPreview={mediaUrl(user.profile_photo, user.updated_at)}
          testId="upload-profile-photo"
          ariaLabel={t("profile.profilePhoto")}
        />
      </FieldGroup>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.firstName")} required error={errors.first_name}>
          <Input
            name="first_name"
            required
            defaultValue={user.first_name}
            aria-invalid={!!errors.first_name}
          />
        </Field>
        <Field label={t("auth.lastName")} required error={errors.last_name}>
          <Input
            name="last_name"
            required
            defaultValue={user.last_name}
            aria-invalid={!!errors.last_name}
          />
        </Field>
        <Field label={t("common.email")} required error={errors.email}>
          <Input
            name="email"
            type="email"
            required
            defaultValue={user.email}
            aria-invalid={!!errors.email}
          />
        </Field>
        <Field label={t("common.phone")} error={errors.phone}>
          <Input
            name="phone"
            defaultValue={user.phone ?? ""}
            placeholder="01XXXXXXXXX"
            aria-invalid={!!errors.phone}
          />
        </Field>
        <Field label={t("profile.dateOfBirth")} name="date_of_birth" error={errors.date_of_birth}>
          <Input name="date_of_birth" type="date" defaultValue={user.date_of_birth ?? ""} />
        </Field>
        <Field label={t("profile.gender")} name="gender" error={errors.gender}>
          <Select name="gender" defaultValue={user.gender ?? ""}>
            <option value="">{t("profile.selectPlaceholder")}</option>
            <option value="male">{t("profile.male")}</option>
            <option value="female">{t("profile.female")}</option>
            <option value="other">{t("profile.other")}</option>
          </Select>
        </Field>
      </div>

      <Field label={t("common.address")}>
        <Textarea name="address" defaultValue={user.address ?? ""} rows={2} />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
        {t("profile.updateProfile")}
      </Button>
    </form>
  );
}
