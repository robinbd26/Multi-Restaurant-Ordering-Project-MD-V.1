"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { FieldError } from "@/components/ui/field-error";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, imageFileProblem } from "@/lib/validation/limits";

export interface ExistingImage {
  /** Whatever the caller uses to identify it on removal (an index, a key). */
  id: string;
  url: string;
}

/**
 * THE image upload field, used everywhere the app takes a picture: product
 * images, brand logos, profile pictures, employee photos, chat, review and
 * complaint photos. Replaces the browser's bare "Choose file / No file chosen".
 *
 * - Click or drag and drop onto the zone; keyboard reaches the real input.
 * - Shows a preview of every picked image, each with a remove button.
 * - Says clearly what is wrong: wrong type, too large, too many.
 * - Each caller keeps its own limits (`maxBytes`, `maxFiles`); the type check
 *   is the shared `imageFileProblem`, the same one the server runs.
 *
 * FORM INTEGRATION: with `name`, a real (visually hidden) <input type="file">
 * carries the picked files, so forms that submit FormData or read
 * `form.get(name)` keep working unchanged, and so do tests that call
 * setInputFiles on it. Callers that manage files in state use `onFilesChange`.
 */
export function ImageUpload({
  name,
  multiple = false,
  maxFiles,
  maxBytes = MAX_IMAGE_BYTES,
  onFilesChange,
  existing = [],
  onRemoveExisting,
  initialPreview = null,
  error,
  hint,
  disabled = false,
  variant = "default",
  testId = "image-upload",
  inputTestId,
  ariaLabel,
  resetKey,
}: {
  name?: string;
  multiple?: boolean;
  /** Most images allowed in total (existing + new). Default 1, or 10 when multiple. */
  maxFiles?: number;
  maxBytes?: number;
  onFilesChange?: (files: File[]) => void;
  /** Already-saved images (edit forms), shown with their own remove buttons. */
  existing?: ExistingImage[];
  onRemoveExisting?: (id: string) => void;
  /** Single mode: the current saved image, shown until a new one is picked. */
  initialPreview?: string | null;
  /** An error from the caller (server or form validation). */
  error?: string | null;
  /** Small help text under the zone (formats, limits). */
  hint?: string;
  disabled?: boolean;
  /** "compact" = a slim row for tight spots (chat composer). */
  variant?: "default" | "compact" | "avatar";
  testId?: string;
  inputTestId?: string;
  ariaLabel?: string;
  /** Change it to clear the picked files (after a successful submit). */
  resetKey?: unknown;
}) {
  const { t, fmt } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const limit = maxFiles ?? (multiple ? 10 : 1);
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  // Clear when the caller says so (e.g. after a successful send).
  const [lastReset, setLastReset] = useState(resetKey);
  if (resetKey !== lastReset) {
    setLastReset(resetKey);
    setFiles([]);
    setLocalError(null);
  }

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  // Keep the real input's FileList equal to what is shown, so a native or
  // FormData submit sends exactly these files.
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !name || typeof DataTransfer === "undefined") return;
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
  }, [files, name]);

  function commit(next: File[]) {
    setFiles(next);
    onFilesChange?.(next);
  }

  function add(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const picked = Array.from(list);
    if (picked.length === 0) return;
    for (const file of picked) {
      const problem = imageFileProblem({ name: file.name, type: file.type, size: file.size });
      if (problem === "type") {
        setLocalError(t("upload.wrongType", { types: IMAGE_EXTENSIONS.join(", ").toUpperCase() }));
        return;
      }
      if (problem === "size" || file.size > maxBytes) {
        setLocalError(t("upload.tooLarge", { name: file.name, mb: fmt.num(maxMb) }));
        return;
      }
    }
    if (!multiple) {
      setLocalError(null);
      commit([picked[0]]);
      return;
    }
    const room = limit - existing.length - files.length;
    if (picked.length > room) {
      setLocalError(t("upload.tooMany", { max: fmt.num(limit) }));
      if (room <= 0) return;
    } else {
      setLocalError(null);
    }
    commit([...files, ...picked.slice(0, Math.max(0, room))]);
  }

  function removeNew(index: number) {
    setLocalError(null);
    commit(files.filter((_, i) => i !== index));
  }

  const shownError = error ?? localError;
  const errorId = `${inputId}-error`;
  const full = multiple ? existing.length + files.length >= limit : false;
  const singlePreview = !multiple ? (previews[0]?.url ?? initialPreview) : null;
  const tiles = [
    ...existing.map((e) => ({ key: `e-${e.id}`, url: e.url, onRemove: onRemoveExisting ? () => onRemoveExisting(e.id) : null })),
    ...previews.map((p, i) => ({ key: `n-${i}-${p.file.name}`, url: p.url, onRemove: () => removeNew(i) })),
  ];

  const zone = (
    <label
      htmlFor={inputId}
      data-testid={testId}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        add(e.dataTransfer.files);
      }}
      className={cn(
        "group flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-500",
        variant === "compact" ? "gap-2 px-3 py-2" : "flex-col gap-2 px-4 py-6",
        dragOver
          ? "border-brand-500 bg-brand-50/70 dark:bg-brand-500/10"
          : shownError
            ? "border-red-400 dark:border-red-500/60"
            : "border-border-strong hover:border-brand-400 hover:bg-surface-muted/50",
        (disabled || full) && "pointer-events-none opacity-50",
      )}
    >
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple={multiple}
        disabled={disabled || full}
        className="sr-only"
        aria-label={ariaLabel ?? t("upload.clickOrDrag")}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={shownError ? errorId : undefined}
        data-testid={inputTestId}
        onChange={(e) => {
          add(e.target.files);
          // Re-picking the same file must fire change again (multiple mode);
          // in single mode with a name the effect re-assigns the FileList.
          if (multiple || !name) e.target.value = "";
        }}
      />
      {singlePreview && variant !== "compact" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob/preview URL
        <img
          src={singlePreview}
          alt={t("upload.preview")}
          className={cn("object-cover ring-1 ring-border-base", variant === "avatar" ? "size-20 rounded-full" : "size-20 rounded-xl")}
        />
      ) : (
        <UploadIcon className={cn("text-fg-muted", variant === "compact" ? "size-5" : "size-8")} />
      )}
      <span className={cn("font-medium text-fg-base", variant === "compact" ? "text-xs" : "text-sm")}>
        {singlePreview ? t("upload.replace") : t("upload.clickOrDrag")}
      </span>
      {hint && variant !== "compact" ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
    </label>
  );

  return (
    <div className="space-y-2">
      {zone}
      {variant === "compact" && hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
      {!multiple && files.length > 0 ? (
        <button
          type="button"
          onClick={() => removeNew(0)}
          className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
          data-testid={`${testId}-remove`}
        >
          {t("upload.removeNew", { name: files[0].name })}
        </button>
      ) : null}
      {multiple && tiles.length > 0 ? (
        <ul className="flex flex-wrap gap-2" data-testid={`${testId}-previews`}>
          {tiles.map((tile, i) => (
            <li key={tile.key} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob or access-checked URL */}
              <img src={tile.url} alt={t("upload.previewN", { n: i + 1 })} className="size-20 rounded-xl object-cover ring-1 ring-border-base" />
              {tile.onRemove ? (
                <button
                  type="button"
                  onClick={tile.onRemove}
                  aria-label={t("upload.removeN", { n: i + 1 })}
                  className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow ring-2 ring-surface-card hover:bg-red-700"
                  data-testid={`${testId}-remove-${i}`}
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {multiple ? (
        <p className="text-xs text-fg-subtle">{t("upload.countOf", { n: fmt.num(existing.length + files.length), max: fmt.num(limit) })}</p>
      ) : null}
      <FieldError id={errorId} message={shownError ?? null} />
    </div>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5" />
    </svg>
  );
}
