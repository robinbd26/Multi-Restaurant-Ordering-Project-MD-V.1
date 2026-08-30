"use client";

import { useActionState, useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";

import { PasswordStrengthMeter, PasswordSuggestion } from "@/components/auth/password-suggestion";
import { UsernameField } from "@/components/auth/username-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/forms/password-input";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { registerAction, type AuthFormState } from "@/lib/auth/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { required, email, phone, password as passwordRule, matches } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

const initialState: AuthFormState = { error: null, fieldErrors: {} };

/** Optional NID/licence images — checked against the same limits the server uses. */
const RIDER_FILES = {
  nid_front_image: false,
  nid_back_image: false,
  license_image: false,
};

/** Shared registration form; `rolePath` picks the backend endpoint. */
export function RegisterForm({
  rolePath,
  withRiderFields = false,
}: {
  rolePath: string;
  withRiderFields?: boolean;
}) {
  const action = registerAction.bind(null, rolePath);
  const [state, formAction, pending] = useActionState(action, initialState);
  const { t } = useTranslation();

  const formRef = useRef<HTMLFormElement>(null);
  /** Mirrors of the two name boxes — the username suggestion derives from them. */
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  /**
   * Mirror of the password box, read by the strength meter only. The input
   * itself stays UNCONTROLLED so browser autofill and password managers keep
   * behaving exactly as they did before this field grew a meter.
   */
  const [passwordValue, setPasswordValue] = useState("");

  /**
   * Accept a suggested password into BOTH boxes.
   *
   * The inputs are uncontrolled, so the value is written through the native
   * setter and an `input` event is dispatched by hand: React's value tracker
   * would otherwise treat `el.value = …` as "nothing changed" and swallow the
   * event, and useFormValidation's onChange — the thing that clears the stale
   * "passwords do not match" error — would never run.
   */
  const acceptPassword = useCallback((password: string) => {
    const form = formRef.current;
    if (!form) return;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    for (const name of ["password", "password_confirm"]) {
      const el = form.elements.namedItem(name);
      if (!(el instanceof HTMLInputElement)) continue;
      setValue?.call(el, password);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setPasswordValue(password);
  }, []);

  const RULES: FieldRules = useMemo(
    () => ({
      first_name: [required],
      last_name: [required],
      username: [required],
      phone: [required, phone],
      email: [required, email],
      // Same policy the server enforces in validatePassword().
      password: [required, passwordRule],
      password_confirm: [required, matches("password")],
      ...(withRiderFields
        ? {
            nid_number: [required],
            vehicle_type: [required],
            emergency_contact_name: [required],
            emergency_contact_phone: [required, phone],
          }
        : {}),
    }),
    [withRiderFields],
  );
  const files = useMemo(() => (withRiderFields ? RIDER_FILES : {}), [withRiderFields]);

  const { errors, formProps } = useFormValidation(RULES, {
    files,
    // Duplicate username/email/phone come back keyed by field and land below it.
    serverErrors: state.fieldErrors,
    submissionId: state.submissionId,
    pending,
  });

  return (
    <form ref={formRef} action={formAction} {...formProps} className="space-y-4">
      <Alert tone="error" message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* The two name boxes stay uncontrolled; `onChange` only mirrors them
            out so UsernameField can derive a suggestion from what is typed. */}
        <Field label={t("auth.firstName")} required error={errors.first_name}>
          <Input
            name="first_name"
            required
            aria-invalid={!!errors.first_name}
            placeholder={t("register.firstNamePlaceholder")}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)}
          />
        </Field>
        <Field label={t("auth.lastName")} required error={errors.last_name}>
          <Input
            name="last_name"
            required
            aria-invalid={!!errors.last_name}
            placeholder={t("register.lastNamePlaceholder")}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <UsernameField firstName={firstName} lastName={lastName} error={errors.username} />
        <Field label={t("register.phoneNumber")} required hint={t("auth.phoneHint")} error={errors.phone}>
          <Input name="phone" required aria-invalid={!!errors.phone} placeholder="01XXXXXXXXX" />
        </Field>
      </div>

      <Field label={t("common.email")} required error={errors.email}>
        <Input name="email" type="email" required aria-invalid={!!errors.email} placeholder="email@example.com" />
      </Field>

      <Field label={t("register.addressLabel")}>
        <Textarea name="address" rows={2} placeholder={t("register.currentAddressPlaceholder")} />
      </Field>

      {withRiderFields ? (
        <fieldset className="space-y-4 rounded-2xl border border-border-base p-4">
          <legend className="px-2 text-sm font-semibold text-fg-base">{t("register.riderInfo")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("register.nidNumber")} required error={errors.nid_number}>
              <Input name="nid_number" required aria-invalid={!!errors.nid_number} placeholder={t("register.nidPlaceholder")} />
            </Field>
            <Field label={t("register.vehicleType")} required error={errors.vehicle_type}>
              <Input name="vehicle_type" required aria-invalid={!!errors.vehicle_type} placeholder={t("register.vehiclePlaceholder")} />
            </Field>
            <Field label={t("register.drivingLicense")}>
              <Input name="driving_license_number" placeholder={t("register.licensePlaceholder")} />
            </Field>
            <Field label={t("register.bikeReg")}>
              <Input name="bike_registration_number" placeholder={t("register.bikeRegPlaceholder")} />
            </Field>
            <Field label={t("register.bloodGroup")}>
              <Input name="blood_group" placeholder="O+" />
            </Field>
            <Field label={t("register.education")}>
              <Input name="education" placeholder={t("register.educationHint")} />
            </Field>
            <Field label={t("register.emergencyName")} required error={errors.emergency_contact_name}>
              <Input name="emergency_contact_name" required aria-invalid={!!errors.emergency_contact_name} placeholder={t("register.emergencyNamePlaceholder")} />
            </Field>
            <Field label={t("register.emergencyPhone")} required error={errors.emergency_contact_phone}>
              <Input name="emergency_contact_phone" required aria-invalid={!!errors.emergency_contact_phone} placeholder="01XXXXXXXXX" />
            </Field>
          </div>
          <Field label={t("register.presentAddress")}>
            <Textarea name="present_address" rows={2} />
          </Field>
          <Field label={t("register.permanentAddress")}>
            <Textarea name="permanent_address" rows={2} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("register.nidFront")} name="nid_front_image" error={errors.nid_front_image}>
              <Input name="nid_front_image" type="file" accept="image/*" className="py-2" />
            </Field>
            <Field label={t("register.nidBack")} name="nid_back_image" error={errors.nid_back_image}>
              <Input name="nid_back_image" type="file" accept="image/*" className="py-2" />
            </Field>
            <Field label={t("register.licenseImage")} name="license_image" error={errors.license_image}>
              <Input name="license_image" type="file" accept="image/*" className="py-2" />
            </Field>
          </div>
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.passwordLabel")} required hint={t("auth.passwordHint")} error={errors.password}>
          <PasswordInput
            name="password"
            required
            aria-invalid={!!errors.password}
            autoComplete="new-password"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPasswordValue(event.target.value)}
          />
          <PasswordStrengthMeter value={passwordValue} />
        </Field>
        <Field label={t("auth.confirmPassword")} required error={errors.password_confirm}>
          <PasswordInput name="password_confirm" required aria-invalid={!!errors.password_confirm} autoComplete="new-password" />
        </Field>
      </div>

      <PasswordSuggestion onAccept={acceptPassword} />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
        {t("auth.registerButton")}
      </Button>
    </form>
  );
}
