/**
 * SINGLE SOURCE OF TRUTH for upload sizing — the storage-side profiles used by
 * `saveUpload()` (lib/http/upload.ts) and the key naming a consumer needs to
 * point an <img srcset> at a smaller variant.
 *
 * This module is CLIENT-SAFE on purpose: pure constants and string maths, no
 * `node:fs`, no sharp, no "server-only". lib/http/upload.ts cannot be imported
 * from a client component, so the naming rule lives here where both sides can
 * reach it — the same split as lib/validation/limits.ts.
 *
 * WHY IT EXISTS (WS-9.2): a branch manager photographs a dish on a phone and
 * uploads a 4000x3000 original. Before this, the full-resolution image was
 * re-encoded to WebP at its ORIGINAL size and then painted into a 44px table
 * tile on a customer's 3G connection. Uploads are now downscaled at write time
 * and a small variant is written next to the primary.
 */

/** Sizing profile for one storage subdir. */
export type UploadProfile = {
  /**
   * Longest side of the PRIMARY stored file, in pixels. Aspect ratio is
   * preserved and a smaller source is never upscaled.
   */
  maxSide: number;
  /**
   * Extra widths written alongside the primary, smallest-first. Each is a real
   * file at `<key-without-ext>-<width>.webp`, so it inherits the primary's
   * public/private folder and therefore its authorization rules.
   */
  variants: readonly number[];
};

/**
 * Per-subdir profiles, keyed by the `subdir` argument every `saveUpload()`
 * caller already passes. Keeping the table here (rather than a new parameter)
 * means no API route changes.
 *
 *  - products / ramadan_menus — the biggest surfaces in the app: a product
 *    detail hero is at most ~800 CSS px, so 1600 covers a 2x screen exactly.
 *  - branch_logos / branding — marks, never shown above ~200 CSS px.
 *  - profile_photos / employee_photos — avatars, at most 96 CSS px, and they
 *    are PRIVATE so they can never go through the image optimizer
 *    (see localPatterns in next.config.ts). Upload-time sizing is the only
 *    lever there, which is why they get the tightest profile and a 128px
 *    variant for list views.
 */
export const UPLOAD_PROFILES: Record<string, UploadProfile> = {
  products: { maxSide: 1600, variants: [400, 800] },
  ramadan_menus: { maxSide: 1600, variants: [400, 800] },
  branch_logos: { maxSide: 512, variants: [128] },
  branding: { maxSide: 512, variants: [128] },
  profile_photos: { maxSide: 512, variants: [128] },
  employee_photos: { maxSide: 512, variants: [128] },
  // Order chat photos: big enough to read a gate number or a receipt on a
  // phone, with a thumbnail for the message bubble. Private, served only by the
  // chat route (lib/services/order-chat.ts).
  chat_photos: { maxSide: 1280, variants: [320] },
};

/**
 * Fallback for a subdir that is not in the table yet (a future rider NID /
 * licence folder, say). Deliberately conservative rather than unbounded.
 */
export const DEFAULT_UPLOAD_PROFILE: UploadProfile = { maxSide: 1600, variants: [400] };

/** Sizing profile for a storage subdir. */
export function uploadProfile(subdir: string): UploadProfile {
  return UPLOAD_PROFILES[subdir] ?? DEFAULT_UPLOAD_PROFILE;
}

/** Every variant width used anywhere — the set `deleteUpload()` has to sweep. */
export const ALL_VARIANT_WIDTHS: readonly number[] = [
  ...new Set(
    [...Object.values(UPLOAD_PROFILES), DEFAULT_UPLOAD_PROFILE].flatMap((p) => p.variants),
  ),
].sort((a, b) => a - b);

/**
 * Storage key of a variant, e.g. ("products/<uuid>.webp", 400) →
 * "products/<uuid>-400.webp". `-` is used because it is inside the character
 * class `resolveUploadPath()` accepts (lib/upload/paths.ts); `@` is not.
 *
 * Returns null for anything that is not a bare storage key — an absolute URL,
 * a legacy rooted "/uploads/…" path or an empty value — so a caller can fall
 * back to the primary url without a special case.
 */
export function uploadVariantKey(
  key: string | null | undefined,
  width: number,
): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed || trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed)) return null;
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  return `${trimmed.slice(0, dot)}-${width}${trimmed.slice(dot)}`;
}
