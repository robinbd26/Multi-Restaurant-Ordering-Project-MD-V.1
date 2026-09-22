"use client";

import { useActionState, useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { initialActionState } from "@/lib/api/action-state";
import { saveProductAction } from "@/lib/api/actions";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn, mediaUrl } from "@/lib/utils";
import { FormError } from "@/components/ui/field-error";
import { FormSection } from "@/components/catalog/form-section";
import { LIMITS, MAX_IMAGE_MB } from "@/lib/validation/limits";
import { PRODUCT_BRAND_CHOICES, categoryBrandMatchesProductBrand } from "@/lib/constants/enums";
import {
  integer,
  max,
  maxLength,
  min,
  money,
  number,
  oneOf,
  required,
  selectRequired,
} from "@/lib/validation/rules";
import { useFormValidation, type FieldRules } from "@/lib/validation/use-form-validation";
import type { FieldErrors } from "@/lib/validation/contract";
import type { Category, Product } from "@/types";

// "" = "Not applicable" — the product offers no crust/style choice at all
// (rice bowls, drinks…). Only pizza-style products carry THICK/THIN/BOTH.
const VARIATION_TYPES = ["", "THICK", "THIN", "BOTH"];

const RULES: FieldRules = {
  name: [required, maxLength(LIMITS.nameMax)],
  category: [selectRequired], // req #10 — category selection is mandatory
  variation_type: [oneOf(VARIATION_TYPES)],
  description: [maxLength(LIMITS.longTextMax)],
  discount: [number, min(LIMITS.percentMin), max(LIMITS.percentMax)],
  preparation_time: [required, integer, min(LIMITS.minutesMin), max(LIMITS.minutesMax)],
};

const FILES = { image: false };

export interface BranchOption {
  id: number;
  name: string;
  brand_type: string;
}

interface VariationRow {
  id?: number;
  /** Stable React key — survives adding/removing rows so errors never shift. */
  rowKey: string;
  name: string;
  size_label: string;
  price: string;
  variant_type: string;
  is_enabled: boolean;
  is_default: boolean;
}

let rowKeySeq = 0;
const nextRowKey = () => `row-${(rowKeySeq += 1)}`;

function blankVariation(isDefault = false): VariationRow {
  return {
    rowKey: nextRowKey(),
    name: "",
    size_label: "",
    price: "",
    variant_type: "",
    is_enabled: true,
    is_default: isDefault,
  };
}

function rowsFromProduct(product?: Product): VariationRow[] {
  if (product && product.variations.length) {
    return product.variations.map((v) => ({
      id: v.id,
      rowKey: `saved-${v.id}`,
      name: v.name,
      size_label: v.size_label,
      price: v.price,
      variant_type: v.variant_type,
      is_enabled: v.is_enabled,
      is_default: v.is_default,
    }));
  }
  // Variations are optional: a product without any starts with no rows and is
  // sold at its own Base Price.
  return [];
}

export function ProductForm({
  product,
  categories,
  basePath,
  branches,
  fixedBranch,
  showCategoryScope = true,
}: {
  product?: Product;
  categories: Category[];
  basePath: string;
  /** Present when the user must pick a branch (super-admin create). */
  branches?: BranchOption[];
  /** Present when the branch is implicit (branch manager, or edit). */
  fixedBranch?: BranchOption;
  /**
   * Retained (optional) for backward compatibility with callers; the "create a
   * category" empty-state was removed (req #10) so it is no longer rendered.
   */
  categoryCreateHref?: string;
  /**
   * Whether an option may be annotated with its scope (" · Global"). The Super
   * Admin picks categories across every branch and needs that label; the Branch
   * Manager is only offered their own branch's categories, so the suffix would
   * be noise there (and is switched off by the branch-manager pages).
   */
  showCategoryScope?: boolean;
}) {
  const { t, fmt } = useTranslation();
  const action = saveProductAction.bind(null, product?.id ?? null, basePath);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [preview, setPreview] = useState<string | null>(mediaUrl(product?.image ?? null));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const [branchId, setBranchId] = useState<number | null>(
    fixedBranch?.id ?? product?.branch ?? branches?.[0]?.id ?? null,
  );
  const [rows, setRows] = useState<VariationRow[]>(() => rowsFromProduct(product));
  // The product's own price. Used directly while there are NO variations; once
  // any exist, price lives on them and this box is disabled (see Pricing).
  const [basePrice, setBasePrice] = useState<string>(
    product && !product.variations.length ? String(product.price ?? "") : "",
  );
  const [brand, setBrand] = useState<string>(product?.brand ?? "");
  // Controlled category: changing Brand/Branch must be able to CLEAR it (req #3)
  // — an uncontrolled select could never be reset.
  const [categoryId, setCategoryId] = useState<string>(
    product?.category != null ? String(product.category) : "",
  );
  // req #4 — optional Variations: hidden by default; only an EDIT of a product
  // that already has saved variations opens expanded, because hiding existing
  // data would read as data loss.
  const [showVariations, setShowVariations] = useState<boolean>(() =>
    Boolean(product?.variations.length),
  );

  const activeBranch: BranchOption | undefined = useMemo(() => {
    if (fixedBranch) return fixedBranch;
    return branches?.find((b) => b.id === branchId);
  }, [fixedBranch, branches, branchId]);

  const brandType = activeBranch?.brand_type ?? "combined";
  const soleBrand = brandType === "cheez" ? "cheez" : brandType === "madchef" ? "madchef" : null;
  // req #8/#10 — a branch's eligible categories = its own PLUS every global
  // (branch === null) category. Categories assigned to OTHER branches are hidden.
  const branchCategories = useMemo(
    () => categories.filter((c) => c.branch === null || (branchId != null && c.branch === branchId)),
    [categories, branchId],
  );
  // req #3 — the Brand → Category filter. A NULL category brand serves BOTH
  // brands; a "combined" product may use any category; otherwise the tags must
  // match. With no brand chosen yet, every branch category stays visible (the
  // server still rejects a mismatched pair on submit).
  const visibleCategories = useMemo(() => {
    const effectiveBrand = soleBrand ?? brand;
    const list = branchCategories.filter(
      (c) => !effectiveBrand || categoryBrandMatchesProductBrand(c.brand, effectiveBrand),
    );
    // A saved category the new filter would hide stays selectable, so an edit
    // never silently presents "nothing selected".
    const saved =
      product?.category != null ? categories.find((c) => c.id === product.category) : undefined;
    if (saved && !list.some((c) => c.id === saved.id)) list.unshift(saved);
    return list;
  }, [branchCategories, soleBrand, brand, product, categories]);

  /** Assign a dropped file to the real input so it is genuinely submitted. */
  const applyFile = (file: File) => {
    const input = fileInputRef.current;
    if (input) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
      } catch {
        // Older browsers without assignable `files`: click-to-pick still works.
      }
    }
    setPreview(URL.createObjectURL(file));
  };

  // ── Variation mutations ────────────────────────────────────────────
  const setRow = (i: number, patch: Partial<VariationRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((prev) => {
      const row = blankVariation(prev.every((r) => !r.is_default));
      // The first variation inherits the price already typed as the base price.
      if (prev.length === 0) row.price = basePrice;
      return [...prev, row];
    });

  const removeRow = (i: number) =>
    setRows((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      if (!next.some((r) => r.is_default && r.is_enabled)) {
        const firstEnabled = next.findIndex((r) => r.is_enabled);
        if (firstEnabled >= 0) next[firstEnabled] = { ...next[firstEnabled], is_default: true };
      }
      return next;
    });

  const makeDefault = (i: number) =>
    setRows((prev) => prev.map((r, idx) => ({ ...r, is_default: idx === i })));

  const toggleEnabled = (i: number, on: boolean) =>
    setRows((prev) => {
      const next = prev.map((r, idx) => (idx === i ? { ...r, is_enabled: on, is_default: on && r.is_default } : r));
      if (!next.some((r) => r.is_default && r.is_enabled)) {
        const firstEnabled = next.findIndex((r) => r.is_enabled);
        if (firstEnabled >= 0) next[firstEnabled] = { ...next[firstEnabled], is_default: true };
      }
      return next;
    });

  // Serialized payload sent to the API (validated again server-side).
  const variationsJson = JSON.stringify(
    rows.map((r, i) => ({
      id: r.id,
      name: r.name.trim(),
      sizeLabel: r.size_label.trim(),
      price: r.price === "" ? 0 : Number(r.price),
      variantType: r.variant_type.trim(),
      sortOrder: i,
      isDefault: r.is_default,
      isEnabled: r.is_enabled,
    })),
  );

  /**
   * Repeated-row validation. Every row is checked independently and each
   * message is keyed by its STRUCTURED PATH (`variations.0.price`) so it renders
   * under that exact input — one bad row never hides the others and never
   * removes a valid row. The whole-list rule ("at least one enabled") is keyed
   * `variations` and shown once under the section.
   */
  const validateVariations = useCallback((): FieldErrors => {
    const found: FieldErrors = {};
    if (rows.length === 0) {
      // No variations: the base price is what gets sold, so it is required.
      const baseError = money(basePrice, {});
      if (basePrice.trim() === "") found.price = t("validation.required");
      else if (baseError) found.price = t(baseError.key, baseError.vars);
      return found;
    }
    const seen = new Map<string, number>();
    rows.forEach((r, i) => {
      const name = r.name.trim();
      if (!name) {
        found[`variations.${i}.name`] = t("catalog.variationNameRequired");
      } else {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          found[`variations.${i}.name`] = t("catalog.variationNameDuplicate");
        } else {
          seen.set(key, i);
        }
      }
      const priceError = money(r.price, {});
      if (r.price.trim() === "") {
        found[`variations.${i}.price`] = t("validation.required");
      } else if (priceError) {
        found[`variations.${i}.price`] = t(priceError.key, priceError.vars);
      }
    });
    if (!rows.some((r) => r.is_enabled)) {
      found.variations = t("catalog.variationOneEnabledRequired");
    }
    return found;
  }, [rows, basePrice, t]);

  const { errors, formProps } = useFormValidation(RULES, {
    files: FILES,
    validate: validateVariations,
    serverErrors: state.fieldErrors,
    submissionId: state.submissionId,
    pending,
  });

  // A failed submit (client- OR server-side) with a variation problem must
  // never point at a collapsed panel — derive the open state so the panel
  // auto-opens when variation errors exist, without calling setState inside
  // an effect (which the React compiler flags as cascading-render risk).
  const panelOpen = showVariations || Object.keys(errors).some((k) => k.startsWith("variations"));

  // req #4 — the primary price input mirrors the DEFAULT variation's price: the
  // server derives Product.price from the variations, so editing here edits the
  // row that owns the base price (one source of truth, two doors).
  const defaultIdx = (() => {
    const preferred = rows.findIndex((r) => r.is_default && r.is_enabled);
    if (preferred >= 0) return preferred;
    return rows.findIndex((r) => r.is_enabled);
  })();
  const defaultRow = defaultIdx >= 0 ? rows[defaultIdx] : undefined;

  return (
    // The form itself used to be `max-w-3xl`, which is what left the right-hand
    // third of the page empty even after the card around it was widened. It now
    // fills the content column and splits in two: the long-running work (name,
    // description, variations) on the left, the short decisions (where it is
    // sold, price, image, visibility, save) in a sidebar on the right. Below
    // `lg` the columns collapse to one, sidebar last, so nothing is squeezed.
    <form action={formAction} className="space-y-4" {...formProps}>
      <Alert tone="error" message={state.error} />

      <div className="grid items-start gap-4 lg:grid-cols-12">
        {/* ── Main column ─────────────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-8">
          <FormSection title={t("catalog.sectionBasicInfo")}>
            {/* Two thirds of the card: a product name is one short line, and a
                full-bleed input across the main column reads as unfinished. */}
            <div className="sm:grid sm:grid-cols-3">
              <Field
                className="sm:col-span-2"
                label={t("catalog.productName")}
                required
                error={errors.name}
              >
                <Input
                  name="name"
                  required
                  aria-invalid={!!errors.name}
                  defaultValue={product?.name}
                  placeholder={t("catalog.productNamePlaceholder")}
                />
              </Field>
            </div>
            <Field label={t("catalog.description")} name="description" error={errors.description}>
              <Textarea name="description" defaultValue={product?.description} rows={4} />
            </Field>
          </FormSection>

          <FormSection
            title={t("catalog.variations")}
            description={t("catalog.variationsOptional")}
            action={
              <span
                data-testid="variations-count"
                className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-fg-muted"
              >
                {t("catalog.variationsSummary", { n: fmt.num(rows.length) })}
              </span>
            }
          >
            <button
              type="button"
              data-testid="variations-toggle"
              aria-expanded={panelOpen}
              aria-controls="variations-panel"
              onClick={() => setShowVariations((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-base bg-surface-muted/40 px-4 py-3 text-left text-sm font-medium text-fg-base transition-colors hover:bg-surface-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span>{showVariations ? t("catalog.hideVariations") : t("catalog.showVariations")}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`size-4 shrink-0 text-fg-muted transition-transform duration-200 ${
                  showVariations ? "rotate-180" : ""
                }`}
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Whole-list rule (e.g. "keep at least one enabled"), shown once —
                deliberately OUTSIDE the collapsing panel so a server error on a
                hidden list is still visible. */}
            <FormError message={errors.variations} />

            {/* req #4 — the list collapses behind a CSS grid-rows animation
                (0fr → 1fr): height animates smoothly with no JS measuring, and
                `inert` keeps the hidden inputs out of the tab order. */}
            <div
              id="variations-panel"
              className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
              style={{ gridTemplateRows: panelOpen ? "1fr" : "0fr" }}
            >
              <div className="min-h-0 overflow-hidden" inert={!panelOpen || undefined}>
                <div className="space-y-3 pt-1">
            {rows.map((r, i) => (
              // `rowKey` is stable across re-orders/removals so React never
              // re-uses one row's DOM (and its error) for a different row.
              <div
                key={r.rowKey}
                className="rounded-xl border border-border-base bg-surface-muted/50 p-3.5"
                data-testid="variation-row"
              >
                {/* A number, so two rows are never confused for one another and
                    an error can be pointed at out loud. */}
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {t("catalog.variationNumber", { n: fmt.num(i + 1) })}
                </p>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Field
                    label={t("catalog.variationName")}
                    name={`variations.${i}.name`}
                    required
                    error={errors[`variations.${i}.name`]}
                  >
                    <Input
                      name={`variations.${i}.name`}
                      value={r.name}
                      data-testid="variation-name"
                      onChange={(e) => setRow(i, { name: e.target.value })}
                      placeholder={t("catalog.variationNamePlaceholder")}
                    />
                  </Field>
                  <Field label={t("catalog.variationSize")}>
                    <Input value={r.size_label} onChange={(e) => setRow(i, { size_label: e.target.value })} />
                  </Field>
                  <Field
                    label={t("catalog.priceTk")}
                    name={`variations.${i}.price`}
                    required
                    error={errors[`variations.${i}.price`]}
                  >
                    <Input
                      name={`variations.${i}.price`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={r.price}
                      data-testid="variation-price"
                      onChange={(e) => setRow(i, { price: e.target.value })}
                    />
                  </Field>
                  <Field label={t("catalog.variantType")}>
                    <Select
                      name={`variations.${i}.variant_type`}
                      value={r.variant_type}
                      onChange={(e) => setRow(i, { variant_type: e.target.value })}
                    >
                      <option value="">{t("variationType.notApplicable")}</option>
                      <option value="THICK">{t("variationType.THICK")}</option>
                      <option value="THIN">{t("variationType.THIN")}</option>
                      <option value="BOTH">{t("variationType.BOTH")}</option>
                    </Select>
                  </Field>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border-base pt-2.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="__default"
                      checked={r.is_default}
                      disabled={!r.is_enabled}
                      onChange={() => makeDefault(i)}
                    />
                    {t("catalog.variationDefault")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={r.is_enabled}
                      data-testid="variation-enabled"
                      onChange={(e) => toggleEnabled(i, e.target.checked)}
                    />
                    {t("catalog.variationEnabled")}
                  </label>
                  {/* Destructive, but not louder than the fields it removes —
                      and it stays inside its own variation card. */}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    onClick={() => removeRow(i)}
                  >
                    {t("common.remove")}
                  </Button>
                </div>
              </div>
            ))}

                {/* "+ Add Variation" lives INSIDE the panel: an optional section
                    should not advertise a control for content it is hiding. */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addRow}
                  className="w-full sm:w-auto"
                >
                  + {t("catalog.addVariation")}
                </Button>
                </div>
              </div>
            </div>
          </FormSection>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-4">
          <FormSection title={t("catalog.sectionOrganization")}>
            {branches ? (
              <Field label={t("catalog.branch")} name="branch_id" required error={errors.branch_id}>
                <Select
                  name="branch_id"
                  value={branchId ?? ""}
                  onChange={(e) => {
                    // The branch decides WHICH brands and categories are legal —
                    // both selections must reset so stale pairs can never submit.
                    setBranchId(Number(e.target.value));
                    setBrand("");
                    setCategoryId("");
                  }}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              // req #2 — a Branch Manager is locked to the branch they are logged
              // into: rendered read-only. The hint deliberately sits OUTSIDE the
              // <Field> (whose <label> must keep the exact accessible name
              // "Branch" — the audit spec asserts on it).
              <>
                <Field label={t("catalog.branch")}>
                  <Input
                    value={fixedBranch?.name ?? product?.branch_name ?? ""}
                    disabled
                    readOnly
                    data-testid="branch-locked"
                    className="cursor-not-allowed bg-surface-muted/60 text-fg-muted"
                  />
                </Field>
                <p className="text-xs text-fg-subtle">{t("catalog.branchLockedHint")}</p>
              </>
            )}

            {soleBrand ? (
              <input type="hidden" name="brand" value={soleBrand} />
            ) : (
              // req #3 — exactly three choices, offered only on a COMBINED branch
              // (a single-brand branch silently forces its own brand above).
              <Field label={t("catalog.brand")} name="brand" required error={errors.brand}>
                <Select
                  name="brand"
                  value={brand}
                  onChange={(e) => {
                    // Changing brand invalidates a brand-scoped category — clear
                    // it so a mismatched pair can never be submitted (req #3).
                    setBrand(e.target.value);
                    setCategoryId("");
                  }}
                >
                  <option value="">{t("catalog.selectBrand")}</option>
                  {PRODUCT_BRAND_CHOICES.map((b) => (
                    <option key={b} value={b}>
                      {b === "combined" ? t("brands.combinedOption") : t(`brands.${b}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label={t("catalog.category")} required error={errors.category}>
              {visibleCategories.length ? (
                <Select
                  name="category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  aria-invalid={errors.category ? true : undefined}
                >
                  <option value="">{t("catalog.selectCategory")}</option>
                  {visibleCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {showCategoryScope && c.is_global ? ` · ${t("catalog.globalCategory")}` : ""}
                    </option>
                  ))}
                </Select>
              ) : branchCategories.length ? (
                // req #3 — the branch HAS categories, but none match the chosen
                // brand: say so instead of rendering an empty select.
                <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-fg-muted">
                  {t("catalog.noCategoriesForBrand")}
                </p>
              ) : (
                // req #10 — no create-category action for a branch manager; a
                // neutral message directs them to the super admin instead.
                <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-fg-muted">
                  {t("catalog.noCategoriesContactAdmin")}
                </p>
              )}
            </Field>

          </FormSection>

          <FormSection title={t("catalog.sectionPricing")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Variations are optional. With NONE, this is the price that is
                  sold and it is submitted as `price`. With any, price lives on
                  the variations: this box turns into a read-only display of the
                  default variation's price and is NOT submitted. */}
              <Field
                label={t("catalog.basePrice")}
                name="price"
                required={rows.length === 0}
                hint={rows.length === 0 ? t("catalog.basePriceUsedHint") : t("catalog.basePriceLockedHint")}
                error={rows.length === 0 ? errors.price : undefined}
                className="sm:col-span-2"
              >
                {rows.length === 0 ? (
                  <Input
                    name="price"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={basePrice}
                    data-testid="base-price"
                    aria-invalid={errors.price ? true : undefined}
                    onChange={(e) => setBasePrice(e.target.value)}
                  />
                ) : (
                  <Input
                    type="number"
                    value={defaultRow?.price ?? ""}
                    data-testid="base-price"
                    disabled
                    readOnly
                    className="cursor-not-allowed bg-surface-muted/60 text-fg-muted"
                  />
                )}
              </Field>
              <Field label={t("catalog.discount")} name="discount" error={errors.discount}>
                <Input
                  name="discount"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={product?.discount ?? "0"}
                />
              </Field>
              <Field label={t("catalog.prepTime")} name="preparation_time" error={errors.preparation_time}>
                <Input
                  name="preparation_time"
                  type="number"
                  min="1"
                  defaultValue={product?.preparation_time ?? 20}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title={t("catalog.sectionImage")}>
            {/* Leaving the file input empty on edit keeps the saved image — it is
                never cleared by an unrelated validation error elsewhere. */}
            <Field
              label={t("catalog.image")}
              name="image"
              hint={product?.image ? t("catalog.imageKeepHint") : t("catalog.imageFormatsHint", { n: MAX_IMAGE_MB })}
              error={errors.image}
            >
              {/* Modern drag-and-drop zone. The real <input type="file"> stays in
                  the DOM (sr-only) so the multipart `image` part and the E2E
                  setInputFiles selector keep working; the wrapping <label> makes
                  the whole tile clickable, and a dropped file is assigned to the
                  input programmatically so it is genuinely submitted. */}
              <label
                data-testid="image-dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) applyFile(file);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                  dragOver
                    ? "border-brand-500 bg-brand-50/70 dark:bg-brand-500/10"
                    : "border-border-strong hover:border-brand-400 hover:bg-surface-muted/50",
                )}
              >
                <input
                  ref={fileInputRef}
                  name="image"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setPreview(file ? URL.createObjectURL(file) : mediaUrl(product?.image ?? null));
                  }}
                />
                {preview ? (
                  <Image
                    src={preview}
                    alt={t("catalog.preview")}
                    width={80}
                    height={80}
                    className="size-20 rounded-xl border border-border-base object-cover"
                    unoptimized
                  />
                ) : (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="size-9 text-fg-muted"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
                    />
                  </svg>
                )}
                <span className="text-sm font-medium text-fg-base">
                  {preview ? t("catalog.imageChange") : t("catalog.imageDropTitle")}
                </span>
                <span className="text-xs text-fg-muted">
                  {t("catalog.imageFormatsHint", { n: MAX_IMAGE_MB })}
                </span>
              </label>
            </Field>
          </FormSection>

          <FormSection title={t("catalog.sectionVisibility")} contentClassName="space-y-2.5">
            <Checkbox
              name="is_available"
              label={t("catalog.available")}
              defaultChecked={product?.is_available ?? true}
            />
            <Checkbox
              name="is_popular"
              label={t("catalog.popular")}
              defaultChecked={product?.is_popular ?? false}
            />
            <Checkbox
              name="is_recommended"
              label={t("catalog.recommended")}
              defaultChecked={product?.is_recommended ?? false}
            />
          </FormSection>

          {/* Save sits at the foot of the sidebar on desktop and at the foot of
              the single column on mobile — a normal section, not a fixed bar
              that would cover the fields being edited. Buttons are full-width
              and stacked on touch screens, equal-width side by side on sm+. */}
          <div className="flex flex-col gap-3 rounded-2xl border border-border-base bg-surface-card p-4 sm:flex-row">
            <Button type="submit" disabled={pending} className="flex-1">
              {pending ? <Spinner className="size-4 border-white/40 border-t-white" /> : null}
              {product ? t("catalog.saveChanges") : t("catalog.addProduct")}
            </Button>
            <ButtonLink href={basePath} variant="outline" className="flex-1">
              {t("common.cancel")}
            </ButtonLink>
          </div>
        </div>
      </div>

      {/* Serialized variation payload */}
      <input type="hidden" name="variations" value={variationsJson} />
    </form>
  );
}
