// Convert every raster image under public/ to .webp (in place, same folder).
//
// Usage:
//   node scripts/convert-images-to-webp.mjs           # convert, keep originals
//   node scripts/convert-images-to-webp.mjs --delete   # also remove originals
//   node scripts/convert-images-to-webp.mjs --dir public/images  # limit scope
//   node scripts/convert-images-to-webp.mjs --max-side=1200      # tighter cap
//   node scripts/convert-images-to-webp.mjs --include-webp       # also shrink
//                                            # existing .webp files over the cap
//
// Rules:
//   - Converts .jpg .jpeg .png .bmp .tiff .tif .avif → .webp
//   - DOWNSCALES anything longer than --max-side (default 1600px) on its longest
//     side, aspect ratio preserved, never upscaling a smaller image. Bundled art
//     is served to phones on prepaid 3G; a 4000px source in public/ is bytes
//     nobody asked for. Matches the storage cap the upload pipeline applies to
//     runtime uploads (lib/upload/variants.ts).
//   - Preserves folder structure (writes alongside the source)
//   - Skips when an up-to-date .webp already exists (no duplicate work)
//   - Leaves .svg .ico and non-images untouched. Existing .webp files are left
//     alone too unless --include-webp is passed, and even then only the ones
//     ACTUALLY over the cap are rewritten — so re-runs never re-compress a file
//     that is already fine.
//   - Quality 80 (safe visual/size trade-off); EXIF orientation baked in
//   - Only removes originals with --delete, AFTER a successful conversion
import { readdir, stat, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONVERTIBLE = new Set([".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".avif"]);
const QUALITY = 80;
/** Default longest side, in step with UPLOAD_PROFILES in lib/upload/variants.ts. */
const DEFAULT_MAX_SIDE = 1600;

const argv = process.argv.slice(2);
const DELETE = argv.includes("--delete");
const INCLUDE_WEBP = argv.includes("--include-webp");
const dirArg = argv.find((a) => a.startsWith("--dir="))?.split("=")[1];
const maxSideArg = Number(argv.find((a) => a.startsWith("--max-side="))?.split("=")[1]);
const MAX_SIDE = Number.isFinite(maxSideArg) && maxSideArg > 0 ? maxSideArg : DEFAULT_MAX_SIDE;
const SCAN_DIR = path.resolve(ROOT, dirArg ?? "public");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function newerThan(a, b) {
  // true when file `a` is newer than file `b` (source changed after last convert)
  const [sa, sb] = await Promise.all([stat(a), stat(b)]);
  return sa.mtimeMs > sb.mtimeMs;
}

const rel = (p) => path.relative(ROOT, p);
const kb = (bytes) => Math.round(bytes / 1024);

/** Re-encode to WebP, downscaling to MAX_SIDE only when the source is bigger. */
async function toWebp(input) {
  return sharp(input)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();
}

/** True when either side is longer than the cap. */
function oversized(metadata) {
  return (metadata.width ?? 0) > MAX_SIDE || (metadata.height ?? 0) > MAX_SIDE;
}

async function main() {
  const converted = [];
  const shrunk = [];
  const skipped = [];
  const removed = [];
  const failed = [];
  let scanned = 0;
  let savedBytes = 0;

  for await (const file of walk(SCAN_DIR)) {
    const ext = path.extname(file).toLowerCase();
    const isWebp = ext === ".webp";
    if (!CONVERTIBLE.has(ext) && !(isWebp && INCLUDE_WEBP)) continue;
    scanned++;

    try {
      if (isWebp) {
        // In-place shrink of an already-converted asset. Only touched when it
        // genuinely exceeds the cap, so the pass is idempotent and a small
        // image is never re-compressed (which would only lose quality).
        const input = await readFile(file);
        const meta = await sharp(input).metadata();
        if (!oversized(meta)) {
          skipped.push(rel(file));
          continue;
        }
        const webp = await toWebp(input);
        await writeFile(file, webp);
        savedBytes += input.length - webp.length;
        shrunk.push(rel(file));
        console.log(
          `↓ ${rel(file)} ${meta.width}x${meta.height} ${kb(input.length)}KB → ${kb(webp.length)}KB`,
        );
        continue;
      }

      const out = file.slice(0, -ext.length) + ".webp";
      let exists = false;
      try {
        await stat(out);
        exists = true;
      } catch {
        exists = false;
      }
      // Skip if a .webp already exists and is not older than the source.
      if (exists && !(await newerThan(file, out))) {
        skipped.push(rel(out));
      } else {
        const input = await readFile(file);
        const webp = await toWebp(input);
        await writeFile(out, webp);
        savedBytes += input.length - webp.length;
        converted.push(rel(out));
        console.log(`✓ ${rel(file)} → ${rel(out)} (${kb(input.length)}KB → ${kb(webp.length)}KB)`);
      }

      if (DELETE) {
        await unlink(file);
        removed.push(rel(file));
        console.log(`  removed original ${rel(file)}`);
      }
    } catch (err) {
      failed.push(rel(file));
      console.error(`✗ ${rel(file)}: ${err.message}`);
    }
  }

  console.log("\n── image conversion summary ──");
  console.log(`max side:             ${MAX_SIDE}px`);
  console.log(`scanned convertible:  ${scanned}`);
  console.log(`converted:            ${converted.length}`);
  console.log(`downscaled in place:  ${shrunk.length}`);
  console.log(`skipped (up to date): ${skipped.length}`);
  console.log(`originals removed:    ${removed.length}`);
  console.log(`bytes saved:          ${kb(savedBytes)}KB`);
  console.log(`failed:               ${failed.length}`);
  if (failed.length) {
    console.error("FAILED:", failed.join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
