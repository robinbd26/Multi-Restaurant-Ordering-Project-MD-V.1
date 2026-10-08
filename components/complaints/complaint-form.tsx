"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { fileComplaintAction } from "@/lib/api/actions";
import { COMPLAINT_CATEGORIES, COMPLAINT_RECIPIENTS } from "@/lib/constants/enums";
import { useTranslation } from "@/lib/i18n/use-translation";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { COMPLAINT_PHOTO_MAX, PHOTO_MAX_BYTES, PHOTO_MAX_MB } from "@/lib/upload/photos";
import { parseFieldErrors, type FieldErrors } from "@/lib/validation/contract";
import { LIMITS } from "@/lib/validation/limits";
import { maxLength, oneOf, required, selectRequired } from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";

export interface ComplaintOrderOption {
  id: number;
  branch: number;
  label: string;
  /** Customers: who this order's complaint reaches ("Goes to: Gulshan branch manager"). */
  goesTo?: string;
}

const STAFF_RULES: FieldRules = {
  recipient_role: [selectRequired, oneOf(COMPLAINT_RECIPIENTS)],
  category: [selectRequired, oneOf(COMPLAINT_CATEGORIES)],
  subject: [required, maxLength(150)],
  message: [required, maxLength(LIMITS.longTextMax)],
};

const CUSTOMER_RULES: FieldRules = {
  category: [selectRequired, oneOf(COMPLAINT_CATEGORIES)],
  subject: [required, maxLength(150)],
  message: [required, maxLength(LIMITS.longTextMax)],
};

/**
 * "File a complaint".
 *
 * Customer: no recipient choice. It is always the branch manager of the
 * selected order's branch, shown as fixed text with a live "Goes to" line;
 * the server routes it the same way (super admin when that branch has no
 * manager, or when no order is chosen). Up to 5 photos.
 *
 * Staff and riders: the recipient dropdown as before (JSON, no photos).
 */
export function ComplaintForm({ orders, customer = false }: { orders: ComplaintOrderOption[]; customer?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [recipient, setRecipient] = useState("");
  const [category, setCategory] = useState("");
  const [orderId, setOrderId] = useState(customer && orders[0] ? String(orders[0].id) : "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submissionId, setSubmissionId] = useState(0);

  const selectedOrder = orders.find((o) => String(o.id) === orderId) ?? null;

  /** Runs only after every client rule passed. */
  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setApiError(null);
      start(async () => {
        if (customer) {
          // Multipart, so the photos travel with it. The recipient is not sent:
          // the server decides it from the order.
          const form = new FormData();
          form.set("category", category);
          form.set("subject", subject.trim());
          form.set("message", message.trim());
          if (selectedOrder) form.set("order_id", String(selectedOrder.id));
          for (const p of photos) form.append("photos", p);
          const res = await fetch("/api/complaints", { method: "POST", body: form });
          const body = await res.json().catch(() => ({}));
          setSubmissionId((n) => n + 1);
          if (!res.ok) {
            const parsed = parseFieldErrors(body, t("common.error"));
            setServerErrors(parsed.fieldErrors);
            setApiError(parsed.formError ?? parsed.fieldErrors.photos ?? null);
            return;
          }
          setServerErrors({});
          router.push(`/complaints/${(body as { id: number }).id}`);
          router.refresh();
          return;
        }
        const res = await fileComplaintAction({
          recipient_role: recipient,
          category,
          subject: subject.trim(),
          message: message.trim(),
          order_id: selectedOrder?.id ?? null,
          branch_id: selectedOrder?.branch ?? null,
        });
        setSubmissionId((n) => n + 1);
        setServerErrors(res.fieldErrors ?? {});
        if (res.error || Object.keys(res.fieldErrors ?? {}).length > 0) {
          // Every typed value stays exactly as it was.
          setApiError(res.error);
          return;
        }
        if (res.complaintId) router.push(`/complaints/${res.complaintId}`);
      });
    },
    [category, customer, message, photos, recipient, router, selectedOrder, subject, t],
  );

  const { errors, formProps } = useFormValidation(customer ? CUSTOMER_RULES : STAFF_RULES, {
    onSubmitValid: submit,
    serverErrors,
    submissionId,
    pending,
  });

  const categoryField = (
    <Field label={t("complaints.category")} name="category" required error={errors.category}>
      <Select name="category" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="complaint-category">
        <option value="">{t("complaints.selectCategory")}</option>
        {COMPLAINT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(`complaintCategory.${c}`)}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form {...formProps} className="space-y-4" data-testid="complaint-form">
      <Alert tone="error" message={apiError} />

      {customer ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-fg-base">{t("complaints.recipient")}</p>
              <p className="mt-1.5 flex min-h-10 items-center rounded-xl border border-border-base bg-surface-muted px-3 text-sm text-fg-base" data-testid="complaint-recipient-fixed">
                {t("roles.branch_manager")}
              </p>
              <p className="mt-1 text-xs text-fg-subtle" data-testid="complaint-goes-to" aria-live="polite">
                {selectedOrder?.goesTo ?? t("complaints.goesToAdminNoOrder")}
              </p>
            </div>
            {categoryField}
          </div>

          <Field label={t("complaints.relatedOrder")} name="order_id" error={errors.order_id} hint={orders.length === 0 ? t("complaints.noOrdersYet") : undefined}>
            <Select name="order_id" value={orderId} onChange={(e) => setOrderId(e.target.value)} data-testid="complaint-order">
              <option value="">{t("complaints.noOrder")}</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("complaints.recipient")} name="recipient_role" required error={errors.recipient_role}>
              <Select name="recipient_role" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                <option value="">{t("complaints.selectRecipient")}</option>
                {COMPLAINT_RECIPIENTS.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {categoryField}
          </div>

          {orders.length > 0 ? (
            <Field label={t("complaints.relatedOrder")} name="order_id" error={errors.order_id}>
              <Select name="order_id" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">{t("complaints.noOrder")}</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </>
      )}

      <Field label={t("complaints.subject")} name="subject" required error={errors.subject}>
        <Input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} data-testid="complaint-subject" />
      </Field>

      <Field label={t("complaints.message")} name="message" required error={errors.message}>
        <Textarea name="message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="complaint-message" />
      </Field>

      {customer ? (
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg-base">{t("complaints.photosLabel", { max: COMPLAINT_PHOTO_MAX })}</p>
          <ImageUpload
            multiple
            maxFiles={COMPLAINT_PHOTO_MAX}
            maxBytes={PHOTO_MAX_BYTES}
            onFilesChange={setPhotos}
            hint={t("upload.photoHint", { mb: PHOTO_MAX_MB })}
            error={serverErrors.photos}
            testId="complaint-photos"
            inputTestId="complaint-photos-input"
          />
        </div>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending} data-testid="complaint-submit">
          {pending ? t("common.saving") : t("complaints.submit")}
        </Button>
      </div>
    </form>
  );
}
