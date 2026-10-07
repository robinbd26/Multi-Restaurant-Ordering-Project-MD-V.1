"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { accentForeground, BRAND_COLOR_PATTERN, BRAND_SLUG_PATTERN, type BrandInfo } from "@/lib/brands/shared";
import { useTranslation } from "@/lib/i18n/use-translation";
import { parseFieldErrors } from "@/lib/validation/contract";
import { IMAGE_MIME_TYPES } from "@/lib/validation/limits";
import { validateImageFile } from "@/lib/validation/rules";

/** "Cheez! Pizza" → "cheez-pizza", a starting suggestion for the slug field. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Create / edit one brand (super admin, /admin/brands). Sends multipart to
 * /api/brands so a logo can ride along; the API and lib/services/brands.ts
 * re-validate every field, so the checks here are only for fast feedback.
 *
 * The slug is chosen once, at creation: products, categories and order lines
 * point at it, so it is shown read-only when editing.
 */
export function BrandForm({ brand }: { brand?: BrandInfo }) {
  const { t } = useTranslation();
  const router = useRouter();
  const editing = Boolean(brand);
  const [name, setName] = useState(brand?.name ?? "");
  const [slug, setSlug] = useState(brand?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [color, setColor] = useState(brand?.accent_color ?? "#e8192c");
  const [preview, setPreview] = useState<string | null>(brand?.logo ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const local: Record<string, string> = {};
    if (!String(data.get("name") ?? "").trim()) local.name = t("errors.brands.nameRequired");
    if (!editing && !BRAND_SLUG_PATTERN.test(String(data.get("slug") ?? ""))) local.slug = t("errors.brands.slugInvalid");
    if (!BRAND_COLOR_PATTERN.test(String(data.get("accent_color") ?? ""))) local.accent_color = t("errors.brands.colorInvalid");
    const logo = data.get("logo");
    if (logo instanceof File && logo.size > 0) {
      const problem = validateImageFile(logo, false);
      if (problem) local.logo = t(problem.key, problem.vars);
    } else {
      data.delete("logo");
    }
    // Unticked checkboxes are absent from FormData; say "false" explicitly.
    for (const key of ["show_crust_guide", "is_active"]) data.set(key, data.get(key) ? "true" : "false");
    if (editing) data.delete("slug");
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    setPending(true);
    try {
      const res = await fetch(editing ? `/api/brands/${brand!.id}` : "/api/brands", {
        method: editing ? "PATCH" : "POST",
        body: data,
      });
      if (!res.ok) {
        const parsed = parseFieldErrors(await res.json().catch(() => ({})), t("common.error"));
        setErrors(parsed.fieldErrors);
        setFormError(Object.keys(parsed.fieldErrors).length ? null : parsed.formError);
        return;
      }
      router.push("/admin/brands");
      router.refresh();
    } catch {
      setFormError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-testid="brand-form">
      <Alert tone="error" message={formError} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("brandsAdmin.name")} name="name" required error={errors.name}>
          <Input
            name="name"
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            data-testid="brand-name"
          />
        </Field>
        <Field label={t("brandsAdmin.nameBn")} name="name_bn" hint={t("brandsAdmin.nameBnHint")} error={errors.name_bn}>
          <Input name="name_bn" defaultValue={brand?.name_bn ?? ""} maxLength={60} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("brandsAdmin.slug")}
          name="slug"
          required={!editing}
          hint={editing ? t("brandsAdmin.slugLockedHint") : t("brandsAdmin.slugHint")}
          error={errors.slug}
        >
          <Input
            name="slug"
            value={slug}
            readOnly={editing}
            disabled={editing}
            maxLength={32}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            data-testid="brand-slug"
          />
        </Field>
        <Field label={t("brandsAdmin.accentColor")} name="accent_color" required error={errors.accent_color}>
          <span className="flex items-center gap-3">
            <input
              type="color"
              aria-label={t("brandsAdmin.accentColor")}
              value={BRAND_COLOR_PATTERN.test(color) ? color : "#e8192c"}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-border-base bg-transparent"
            />
            <Input name="accent_color" value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} className="max-w-32 font-mono" data-testid="brand-color" />
            <span
              className="rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{
                background: BRAND_COLOR_PATTERN.test(color) ? color : "#e8192c",
                color: accentForeground(color),
              }}
            >
              {t("brandsAdmin.colorPreview")}
            </span>
          </span>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("brandsAdmin.description")} name="description" hint={t("brandsAdmin.descriptionHint")} error={errors.description}>
          <Textarea name="description" rows={2} maxLength={200} defaultValue={brand?.description ?? ""} />
        </Field>
        <Field label={t("brandsAdmin.descriptionBn")} name="description_bn" error={errors.description_bn}>
          <Textarea name="description_bn" rows={2} maxLength={200} defaultValue={brand?.description_bn ?? ""} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("brandsAdmin.tagline")} name="tagline" hint={t("brandsAdmin.taglineHint")} error={errors.tagline}>
          <Input name="tagline" maxLength={40} defaultValue={brand?.tagline ?? ""} />
        </Field>
        <Field label={t("brandsAdmin.taglineBn")} name="tagline_bn" error={errors.tagline_bn}>
          <Input name="tagline_bn" maxLength={40} defaultValue={brand?.tagline_bn ?? ""} />
        </Field>
        <Field label={t("brandsAdmin.emoji")} name="emoji" hint={t("brandsAdmin.emojiHint")} error={errors.emoji}>
          <Input name="emoji" maxLength={8} defaultValue={brand?.emoji ?? "🍽️"} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("brandsAdmin.logo")} name="logo" hint={t("brandsAdmin.logoHint")} error={errors.logo}>
          <span className="flex items-center gap-3">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-base bg-surface-muted text-2xl">
              {preview ? <Image src={preview} alt="" fill sizes="56px" className="object-cover" unoptimized /> : "🍽️"}
            </span>
            <input
              ref={fileRef}
              type="file"
              name="logo"
              accept={IMAGE_MIME_TYPES.join(",")}
              className="text-sm text-fg-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : (brand?.logo ?? null));
              }}
            />
          </span>
        </Field>
        <Field label={t("brandsAdmin.sortOrder")} name="sort_order" hint={t("brandsAdmin.sortOrderHint")} error={errors.sort_order}>
          <Input name="sort_order" type="number" min={0} max={9999} defaultValue={brand ? String(brand.sort_order) : ""} />
        </Field>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-border-base p-4">
        <Checkbox name="is_active" label={t("brandsAdmin.activeLabel")} defaultChecked={brand?.is_active ?? true} />
        <p className="-mt-1 pl-6.5 text-xs text-fg-muted">{t("brandsAdmin.activeHint")}</p>
        <Checkbox name="show_crust_guide" label={t("brandsAdmin.crustGuideLabel")} defaultChecked={brand?.show_crust_guide ?? false} />
        <p className="-mt-1 pl-6.5 text-xs text-fg-muted">{t("brandsAdmin.crustGuideHint")}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} data-testid="brand-save">
          {pending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
          {editing ? t("common.save") : t("brandsAdmin.create")}
        </Button>
        <ButtonLink href="/admin/brands" variant="outline">
          {t("common.cancel")}
        </ButtonLink>
      </div>
    </form>
  );
}
