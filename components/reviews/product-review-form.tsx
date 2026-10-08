"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { StarInput, Stars } from "@/components/reviews/stars";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { Field, Textarea } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { REVIEW_COMMENT_MAX } from "@/lib/reviews/policy";
import { PHOTO_MAX_BYTES, PHOTO_MAX_MB, REVIEW_PHOTO_MAX } from "@/lib/upload/photos";
import { parseFieldErrors } from "@/lib/validation/contract";

export interface MyReview {
  id: number;
  rating: number;
  comment: string;
  photos: { url: string; thumb: string }[];
  is_hidden?: boolean;
}

/**
 * Rate one product: 1-5 stars, optional text, up to 3 optional photos (the
 * shared photo pipeline). Creates the customer's review or edits it; the
 * server decides eligibility and enforces every limit.
 */
export function ProductReviewForm({
  productId,
  productName,
  initial = null,
  testId,
}: {
  productId: number;
  productName: string;
  initial?: MyReview | null;
  testId?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!initial);
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [keep, setKeep] = useState<number[]>(() => (initial?.photos ?? []).map((_, i) => i));
  const [files, setFiles] = useState<File[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = testId ?? `review-form-${productId}`;
  const starLabels = [1, 2, 3, 4, 5].map((n) => t(`reviews.starLabel${n}`));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setErrors({ rating: t("reviews.pickStars") });
      return;
    }
    setErrors({});
    setFormError(null);
    start(async () => {
      const form = new FormData();
      form.set("rating", String(rating));
      form.set("comment", comment.trim());
      if (initial) form.set("keep", JSON.stringify(keep));
      for (const f of files) form.append("photos", f);
      const res = await fetch(`/api/products/${productId}/reviews`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const parsed = parseFieldErrors(body, t("common.error"));
        setErrors(parsed.fieldErrors);
        setFormError(parsed.formError);
        return;
      }
      setSaved(true);
      setEditing(false);
      setFiles([]);
      setResetKey((k) => k + 1);
      router.refresh();
    });
  }

  if (!editing && initial) {
    return (
      <div className="rounded-xl border border-border-base p-4" data-testid={id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-fg-base">{productName}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)} data-testid={`${id}-edit`}>
            {t("reviews.editReview")}
          </Button>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Stars value={initial.rating} />
          {initial.is_hidden ? <span className="text-xs text-amber-600 dark:text-amber-400">{t("reviews.hiddenNotice")}</span> : null}
        </div>
        {initial.comment ? <p className="mt-1 text-sm text-fg-muted">{initial.comment}</p> : null}
        {saved ? <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{t("reviews.thanks")}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border-base p-4" data-testid={id} noValidate>
      <p className="font-medium text-fg-base">{productName}</p>
      <Alert tone="error" message={formError} />
      <div>
        <StarInput value={rating} onChange={setRating} label={t("reviews.yourRating", { name: productName })} labels={starLabels} testId={`${id}-stars`} />
        {errors.rating ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.rating}</p> : null}
      </div>
      <Field label={t("reviews.commentLabel")} name="comment" error={errors.comment}>
        <Textarea
          name="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={REVIEW_COMMENT_MAX}
          placeholder={t("reviews.commentPlaceholder")}
          rows={3}
          data-testid={`${id}-comment`}
        />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium text-fg-base">{t("reviews.photosLabel", { max: REVIEW_PHOTO_MAX })}</p>
        <ImageUpload
          multiple
          maxFiles={REVIEW_PHOTO_MAX}
          maxBytes={PHOTO_MAX_BYTES}
          existing={(initial?.photos ?? [])
            .map((p, i) => ({ id: String(i), url: p.thumb }))
            .filter((p) => keep.includes(Number(p.id)))}
          onRemoveExisting={(photoId) => setKeep((k) => k.filter((i) => i !== Number(photoId)))}
          onFilesChange={setFiles}
          resetKey={resetKey}
          hint={t("upload.photoHint", { mb: PHOTO_MAX_MB })}
          error={errors.photos}
          testId={`${id}-photos`}
          inputTestId={`${id}-photos-input`}
          variant="compact"
        />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {initial ? (
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" disabled={pending} data-testid={`${id}-submit`}>
          {pending ? t("common.saving") : initial ? t("reviews.updateReview") : t("reviews.submitReview")}
        </Button>
      </div>
    </form>
  );
}
