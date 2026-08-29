import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import sharp from "sharp";

import { sk, validationError } from "@/lib/http/errors";
import { resolveUploadPath, uploadDir } from "@/lib/upload/paths";
import { ALL_VARIANT_WIDTHS, uploadProfile, uploadVariantKey } from "@/lib/upload/variants";
import { imageFileProblem } from "@/lib/validation/limits";

const WEBP_QUALITY = 80;

/**
 * Variants are decoration on the primary, so they are encoded a notch cheaper —
 * at 128-800px the difference is invisible and the bytes matter more. A 3G
 * customer scrolling a menu is the one paying for this.
 */
const VARIANT_WEBP_QUALITY = 72;

/**
 * WebP cannot encode a side longer than 16383 pixels — libwebp throws outright.
 * Every profile in lib/upload/variants.ts is far below this, so it is now only
 * a backstop for a future profile that is edited upwards by mistake.
 */
const WEBP_MAX_SIDE = 16383;

/** A prepared sharp pipeline. `sharp` is an `export =` module, so its own
 * interface is not importable as a namespace here — derive it instead. */
type SharpPipeline = ReturnType<typeof sharp>;

/**
 * Persist an uploaded image into the runtime UPLOAD_DIR (see lib/upload/paths)
 * and return a stable STORAGE KEY — e.g. "profile_photos/<uuid>.webp" — which
 * is what gets stored in the database. The key is served back to the browser by
 * the /api/uploads route handler, so it works in dev and production (`next
 * start`) alike, and never depends on `public/` being rebuilt.
 *
 * Every accepted image is re-encoded to WebP (EXIF orientation applied, metadata
 * stripped) and DOWNSCALED to the profile for its subdir (lib/upload/variants),
 * then one or more smaller responsive variants are written next to it. Validates
 * extension, MIME type and size; the filename is a random uuid inside a fixed
 * subdir, so there is no path-traversal surface.
 *
 * WS-9.2: the input cap stays at MAX_IMAGE_BYTES — a branch manager may still
 * upload the raw 4000px photo their phone produced — but what is STORED, and
 * therefore what every customer on a prepaid connection downloads, is bounded.
 */
export async function saveUpload(
  file: File,
  subdir: string,
  field = "image",
): Promise<string> {
  // Accept only image files: extension AND (when the browser supplies one) MIME.
  // Exactly the check the client ran before sending — one shared implementation,
  // so a file the browser accepted is never rejected here for a different rule.
  const problem = imageFileProblem({ name: file.name, type: file.type, size: file.size });
  if (problem === "type") {
    throw validationError({ [field]: sk("errors.upload.imageTypeInvalid") });
  }
  if (problem === "size") {
    throw validationError({ [field]: sk("errors.upload.imageTooLarge") });
  }

  const profile = uploadProfile(subdir);
  const maxSide = Math.min(profile.maxSide, WEBP_MAX_SIDE);

  const input = Buffer.from(await file.arrayBuffer());
  // One decode, reused for the primary and every variant. `.clone()` snapshots
  // the pipeline (including the input buffer and the baked-in rotation) so the
  // source is not parsed once per output size.
  const source = sharp(input, {
    // Sharp refuses images above ~268 megapixels by default. Uploads are
    // explicitly allowed to be any size, so the guard is lifted here — the
    // size ceiling is enforced by MAX_IMAGE_BYTES, not by pixel count.
    limitInputPixels: false,
    // Decode images with recoverable defects (a truncated JPEG, a bad CRC)
    // instead of throwing. The user gets their picture; they do not get an
    // "invalid image type" message about a file that opens fine elsewhere.
    failOn: "none",
  })
    // `.rotate()` bakes in EXIF orientation before the metadata is dropped.
    .rotate();

  let webp: Buffer;
  try {
    webp = await source
      .clone()
      // `fit: inside` preserves the aspect ratio and `withoutEnlargement` means
      // a small image is never upscaled — a 300px logo stays 300px.
      .resize({
        width: maxSide,
        height: maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    // Not a decodable image despite its extension/MIME.
    throw validationError({ [field]: sk("errors.upload.imageTypeInvalid") });
  }

  const key = `${subdir}/${randomUUID()}.webp`;
  const abs = resolveUploadPath(key)!; // key is built from a uuid — always safe
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, webp);

  await writeVariants(key, source, profile.variants);
  return key;
}

/**
 * Write the smaller responsive copies of a stored upload. Best effort by
 * design: the primary is already on disk and is what the database records, so a
 * variant that fails to encode or write degrades to "this image has no small
 * copy", never to a failed upload. Consumers must fall back to the primary key
 * anyway, because every row uploaded before WS-9.2 has no variants at all.
 */
async function writeVariants(
  key: string,
  source: SharpPipeline,
  widths: readonly number[],
): Promise<void> {
  for (const width of widths) {
    const variantKey = uploadVariantKey(key, width);
    const abs = variantKey ? resolveUploadPath(variantKey) : null;
    if (!abs) continue;
    try {
      const buffer = await source
        .clone()
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: VARIANT_WEBP_QUALITY })
        .toBuffer();
      await writeFile(abs, buffer);
    } catch {
      // Leave the primary in place; see the doc comment above.
    }
  }
}

/**
 * Best-effort delete of a previously stored upload when it is replaced — the
 * primary AND every responsive variant that may sit next to it. Only acts on
 * bare runtime storage keys (e.g. "profile_photos/<uuid>.webp"); legacy rooted
 * paths ("/uploads/…", absolute URLs) are ignored so nothing outside the upload
 * dir is ever touched.
 *
 * Every known variant width is swept, not just the ones the current profile
 * declares, so a file written under an older profile is still cleaned up.
 */
export async function deleteUpload(key: string | null | undefined): Promise<void> {
  if (!key || key.startsWith("/") || /^https?:\/\//i.test(key)) return;
  const keys = [key, ...ALL_VARIANT_WIDTHS.map((w) => uploadVariantKey(key, w))];
  for (const candidate of keys) {
    if (!candidate) continue;
    const abs = resolveUploadPath(candidate);
    if (!abs || !abs.startsWith(uploadDir())) continue;
    await unlink(abs).catch(() => {}); // already gone / never written — fine
  }
}

/** True when a form value is a non-empty uploaded File. */
export function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}
