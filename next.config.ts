import type { NextConfig } from "next";

/**
 * Optional CDN / object-store base for uploaded media
 * (`NEXT_PUBLIC_UPLOAD_BASE_URL`, consumed by `mediaUrl` in lib/utils/index.ts).
 * When it is set, stored keys resolve to ABSOLUTE urls, which the image
 * optimizer refuses unless the host is allow-listed — so the allow-list is
 * derived from the same env var instead of being hard-coded, and a missing or
 * malformed value simply means "no remote images" rather than a boot failure.
 */
function uploadRemotePatterns(): URL[] {
  const base = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return [];
  try {
    return [new URL(`${base}/**`)];
  } catch {
    return []; // not a URL — degrade to the internal /api/uploads route
  }
}

/** Origin of the optional CDN/object store, for the CSP img-src allow-list. */
function uploadOrigin(): string {
  const base = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL?.trim();
  if (!base) return "";
  try {
    return new URL(base).origin;
  } catch {
    return ""; // same graceful degradation as uploadRemotePatterns above
  }
}

/**
 * Content-Security-Policy (SECURITY.md §9 gap #4).
 *
 * A conservative, WORKING policy rather than a maximally strict one, because
 * two things in this app are incompatible with a nonce-less strict CSP:
 *
 *   • the pre-paint THEME_BOOTSTRAP_SCRIPT is inlined into <head>
 *     (app/layout.tsx), and Next itself streams inline bootstrap/hydration
 *     scripts — hence `script-src 'unsafe-inline'`;
 *   • the Google Maps JS SDK is injected at runtime from maps.googleapis.com
 *     and pulls its own chunks, tiles, fonts and inline styles from Google
 *     hosts — hence the maps/gstatic/fonts entries below.
 *
 * TIGHTENING PATH (documented, not shipped): dropping 'unsafe-inline' requires
 * per-request nonces — generate one in proxy.ts, forward it via a request
 * header, thread it into <Script>/inline tags and Next's own bootstrap scripts
 * (Next supports this when it sees a nonce in the CSP header, which in turn
 * means emitting the CSP from proxy.ts per-request instead of this static
 * block), and stamp it on THEME_BOOTSTRAP_SCRIPT. That also forces every page
 * through the middleware matcher — a measurable cost this 3G-focused app
 * avoids today. Revisit when the middleware layer grows a real security role.
 *
 * What still holds even with 'unsafe-inline': `object-src 'none'` (no Flash-era
 * embeds), `base-uri 'self'` (no <base> hijack), `frame-ancestors 'none'`
 * (clickjacking, the CSP twin of X-Frame-Options below), `form-action 'self'`
 * (forms cannot exfiltrate to foreign origins), and a closed default-src.
 *
 * Verified against the app's own consumers:
 *   • /sw.js (push service worker) is same-origin → `script-src 'self'` +
 *     `worker-src 'self'` cover registration and execution; `blob:` is for the
 *     workers Maps' vector renderer may spawn.
 *   • /api/uploads/** images are same-origin (`img-src 'self'`); the optional
 *     CDN origin is appended when configured. `data:`/`blob:` cover inline
 *     placeholders and client-side previews of not-yet-uploaded photos.
 *   • Dev needs `'unsafe-eval'` (React refresh) and `ws:`/`wss:` (HMR) —
 *     added only outside production so the shipped policy stays tight.
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";
  const cdn = uploadOrigin();
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://maps.googleapis.com https://maps.gstatic.com`,
    // Maps injects inline styles and a Roboto stylesheet from fonts.googleapis.com.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // Map tiles/sprites arrive from several Google image hosts (incl. *.ggpht.com).
    `img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com${cdn ? ` ${cdn}` : ""}`,
    // next/font self-hosts the app's fonts; fonts.gstatic.com is for Maps' Roboto.
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com${cdn ? ` ${cdn}` : ""}${dev ? " ws: wss:" : ""}`,
    // Rider live-map / assignment-gate / branch-location panels embed the Maps
    // EMBED API as an <iframe src="https://www.google.com/maps/embed/...">.
    "frame-src 'self' https://www.google.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ['**.*'],
  /**
   * Security response headers on EVERY path — pages, /api/**, /api/uploads,
   * /sw.js and static assets alike (SECURITY.md §9 gap #4). `/:path*` matches
   * zero-or-more segments, i.e. the root too. Sending CSP on JSON/image
   * responses is harmless and closes the "rendered directly" corner cases.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Browsers must not re-guess content types (e.g. an uploaded file
          // sniffed into something executable).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Legacy-browser twin of CSP frame-ancestors 'none' below.
          { key: "X-Frame-Options", value: "DENY" },
          // Full referrer stays same-origin; cross-origin gets origin only —
          // path/query (order ids, reset-token URLs if ever mis-shared) never
          // leak to Google Maps or any other third party.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app never uses camera/microphone/payment APIs — turn them off
          // outright. Geolocation MUST stay allowed for THIS origin: the
          // customer "use my location" delivery flow depends on it.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), geolocation=(self)" },
          /**
           * HSTS — 180 days, no includeSubDomains, no preload. Deliberately
           * conservative: this ships on a shared VPS whose sibling subdomains
           * are outside this app's control, and includeSubDomains would force
           * HTTPS onto all of them; preload is a near-irreversible public
           * registry commitment. Browsers ignore the header on plain-HTTP
           * responses, so it is safe to send unconditionally. Widen it at the
           * proxy tier once the domain layout is settled.
           */
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
    ];
  },
  // Isolated build output for the e2e gate (NEXT_DIST_DIR=.next-e2e) so a QA
  // build/serve never shares .next with a dev server or another session.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // Product/profile images are uploaded THROUGH a Server Action, and Next
      // caps action bodies at 1 MB by default — which is what produced the
      // "Body exceeded 1 MB limit" 413 and the "Something went wrong" boundary
      // on product create. 50 MB is roughly ten times any phone photo and keeps
      // the transient memory cost sane: Next buffers the whole action body, then
      // sharp decodes it. The image is re-encoded to WebP server-side regardless
      // of what arrives.
      bodySizeLimit: "50mb",
    },
    // A SECOND, independent cap. `proxy.ts` runs on these routes, and the proxy
    // layer defaults to 10 MB — so raising only bodySizeLimit would still have
    // failed for anything above 10 MB. Kept in step with bodySizeLimit above;
    // the lower of the two is what actually applies.
    proxyClientMaxBodySize: "50mb",
  },
  /**
   * WS-9.2 — image delivery for prepaid 3G/4G handsets in Bangladesh.
   *
   * The optimizer used to be switched OFF globally (`unoptimized: true`) because
   * runtime-added files 404'd through the image cache. That is no longer true:
   * uploads are served by the /api/uploads route handler out of the runtime
   * UPLOAD_DIR (see lib/upload/paths.ts), which the optimizer can fetch
   * internally. With it off, a 900x900 brand logo painted into a 28px slot cost
   * a customer the full 40 KB file, and every menu photo shipped at its stored
   * size. It is on now, with an allow-list rather than a blanket "any local
   * path" so the optimizer can never be pointed at something we did not intend.
   */
  images: {
    /**
     * PUBLIC paths only.
     *
     * The optimizer fetches local images through an INTERNAL request that
     * carries no cookies (see fetchInternalImage in Next's image-optimizer), so
     * anything behind `requireApproved()` cannot be optimized — it would come
     * back as a JSON 401 and render as a broken image. The private upload
     * folders (`profile_photos`, `employee_photos`, rider NID/licence) are
     * therefore deliberately absent: they are rendered with a plain <img>
     * anyway (components/common/user-avatar.tsx) and are pre-sized at upload
     * time instead (lib/http/upload.ts).
     *
     * The list mirrors PUBLIC_SUBDIRS in app/api/uploads/[...path]/route.ts —
     * keep the two in step. Anything not listed responds 400, which fails
     * CLOSED and loudly rather than silently leaking private media.
     *
     * `search` is left open on every entry rather than pinned to "": mediaUrl()
     * appends a `?v=<updated_at>` cache-buster to ANY stored image reference
     * (lib/utils/index.ts), including legacy rooted "/images/…" and "/uploads/…"
     * values, and Next's `search` only accepts a literal — there is no pattern
     * that matches a changing timestamp. These are same-origin paths we serve
     * ourselves, and the worst an unexpected query buys is a duplicate entry in
     * an LRU cache that maximumDiskCacheSize already bounds.
     */
    localPatterns: [
      // Bundled brand / storefront art.
      { pathname: "/images/**" },
      // Legacy rooted uploads from before the runtime UPLOAD_DIR move.
      { pathname: "/uploads/**" },
      // Runtime uploads — public folders only (see above).
      { pathname: "/api/uploads/products/**" },
      { pathname: "/api/uploads/branch_logos/**" },
      { pathname: "/api/uploads/branding/**" },
      { pathname: "/api/uploads/ramadan_menus/**" },
    ],
    remotePatterns: uploadRemotePatterns(),
    /**
     * Viewport breakpoints for `sizes`-less / full-width images. Trimmed from
     * Next's default tail (2048, 3840): the audience is phones, and those two
     * only ever serve a retina desktop — at the cost of two extra encodes and
     * two extra cache entries per image. 360 is added because it is the single
     * most common viewport width on the handsets this app targets.
     */
    deviceSizes: [360, 640, 750, 828, 1080, 1200, 1920],
    /** Thumbnail widths (avatars, 44-96px table tiles, logos). Next's default. */
    imageSizes: [32, 48, 64, 96, 128, 256, 384],
    /**
     * Next 16 requires an explicit allow-list; an unlisted `quality` prop snaps
     * to the nearest listed value. 75 is the component default; 50 is here so a
     * photo-heavy surface (menu grid, cart thumbnails) can opt into a cheaper
     * encode without another config change.
     */
    qualities: [50, 75],
    /**
     * WebP only. AVIF is ~20% smaller but ~50% slower to encode, and this app
     * self-hosts the optimizer on the same node that serves orders — a burst of
     * cold menu images must not compete with checkout for CPU. Every source is
     * already WebP, so the remaining win is the resize, not the format.
     */
    formats: ["image/webp"],
    /**
     * 31 days. Sources are immutable in practice (uuid filenames, `?v=` on
     * replacement), so re-optimizing them is pure waste. The effective max-age
     * is the larger of this and the upstream Cache-Control, and /api/uploads
     * already sends `immutable`.
     */
    minimumCacheTTL: 2678400,
    /**
     * Sources are capped well below this by the upload pipeline (max 1600px
     * WebP) and by what ships in public/. 10 MB is generous for a legacy
     * full-resolution upload while protecting a small VPS from buffering a
     * 50 MB source into memory (Next's default).
     */
    maximumResponseBody: 10_000_000,
    /**
     * Bound the on-disk optimized-image cache instead of Next's default
     * "50% of whatever is free at startup", which on a shared VPS can quietly
     * grow into the space the SQLite/Postgres data directory needs.
     */
    maximumDiskCacheSize: 512_000_000,
  },
};

export default nextConfig;
