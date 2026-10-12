# Platform readiness report (monorepo + iOS/Android + desktop)

Read-only inspection of `main` at `ee05581`, 2026-10-12. Nothing in the project was changed.

## 1. Stack
- **Next.js 16.2.10** (built with webpack), **React 19.2.4**, **TypeScript 5.9.3**, Node **24.19** on this machine (`package.json` sets no `engines`). Auth.js `next-auth 5.0.0-beta.31`, Prisma 6.19, Tailwind 4.3.
- **App Router only.** There is no `pages/` folder. Route groups: `app/(auth)`, `app/(auth-full)`, `app/(dashboard)`.
- **189 pages** (`page.tsx`), 4 layouts, **214 API route handlers** (`app/api/**/route.ts`), **221 components** in `components/`, about 30,500 lines in `lib/`, and 71 Prisma models.

## 2. UI layer
- **Tailwind 4** via `postcss.config.mjs` + `app/globals.css` (CSS variables for light/dark). There is one extra plain CSS file, `app/(auth-full)/auth-design.css`, and no CSS modules.
- **No component library.** `components/ui/*` (button, card, input, table…) is home-made: plain `<button>`, `<div>`, `<input>` with Tailwind classes. There are about 4,000 `className=` uses. None of this runs in React Native.
- **Pages are server components** (0 of 189 have `"use client"`). Interactive parts live in `components/`: **166 of 221 are client components**. Next-specific imports are spread widely: `next/link` in 61 files, `next/navigation` in 93, `next/image` in 17.

## 3. Reusable logic (`lib/`)
- `lib/services/*` (50 files) holds the business rules: orders, payments, wallet, riders, coverage, rewards and so on. They all use **Prisma** and `import "server-only"`. Apart from Prisma, they are mostly framework-free. Three exceptions: `branch-schedule.ts` uses `next/cache`, `push.ts` uses `after()` from `next/server`, and every service throws errors from `lib/http/errors.ts`, which imports `NextResponse`.
- **Pure TypeScript** (no Prisma, Next, React, browser or Node): **43 files, about 5,300 lines**. These could move to a shared package today:
  - validation rules shared by client and server: `lib/validation/{contract,limits,rules,username}.ts`
  - opening hours: `lib/hours/*`
  - delivery coverage geometry: `lib/coverage/*`, `lib/services/geo.ts`, `lib/services/coverage-window.ts`
  - policies: `lib/order-chat/policy.ts`, `lib/reviews/policy.ts`, `lib/complaints/routing.ts`
  - constants and enums: `lib/constants/*`
  - i18n: `lib/i18n/{config,dictionaries,format}.ts` plus `messages/en.json` and `messages/bn.json` (4,823 lines each)
  - helpers and types: `lib/utils/dates.ts`, `types/index.ts` (638 lines)
  - Two small snags: `lib/home/brand-availability.ts` takes a type from `lib/selectors` (Prisma), and `lib/utils/index.ts` reads `NEXT_PUBLIC_UPLOAD_BASE_URL`.
- Zod is a dependency but is barely used. Validation is hand-written in `lib/validation/`.

## 4. API and auth
- **Route handlers are the real backend.** Even the 74 server actions in `lib/api/actions.ts` call the app's own `/api/*` over HTTP, passing the user's cookies along (`lib/api/client.ts`). About 46 client files call `fetch("/api/...")` directly. That is good news: a mobile app can call the same endpoints.
- **Server components read the database directly.** 97 pages import `lib/services` / `lib/db` / `lib/selectors` with no API in between. A mobile app would need API endpoints for those screens.
- **Login:** Auth.js with JWT sessions stored in an **encrypted cookie** (`auth.config.ts`, `strategy: "jwt"`). There are two Credentials providers, password and SMS OTP (`auth.ts`). Login runs through server actions (`lib/auth/actions.ts`). Every handler checks the user with `auth()` in `lib/auth/current-user.ts`, which **only reads the cookie**. Nothing accepts an `Authorization: Bearer` header, and there is no token endpoint. `proxy.ts` skips `/api`, so it would not get in the way.
- **Mobile verdict:** a native app cannot log in cleanly today. It could copy the Auth.js cookie by hand, but that is fragile (the CSRF handshake, cookie rolling). You need a small token-login endpoint, plus `requireApiUser` accepting a Bearer token. Error language also comes from a cookie (`lib/http/errors.ts`, `lib/i18n/server.ts`).

## 5. Blockers for mobile apps or a hosted backend
1. **SQLite file DB** (`prisma/schema.prisma`, `migration_lock.toml` = sqlite, 51 migrations). There is no raw SQL, so moving to Postgres is mostly a provider switch. The 51 migrations would need a fresh Postgres baseline.
2. **Uploads on local disk:** `storage/uploads`, written by `lib/http/upload.ts` with `sharp` and served by `app/api/uploads/[...path]/route.ts`. `NEXT_PUBLIC_UPLOAD_BASE_URL` is ready for a CDN, but there is no S3 writer yet. Media URLs are relative (`/api/uploads/...`), so a native app needs an absolute base URL.
3. **Single-process assumptions:** rate limits are an in-memory `Map` (`lib/auth/rate-limit.ts`, which says so itself). Push fan-out runs inside the request via `after()`. Production is one PM2 process behind Nginx (`ecosystem.config.cjs`). This needs a long-running Node server, not serverless.
4. **Relative URLs everywhere** in client code (`fetch("/api/...")`) and in the service worker.

## 6. Realtime and notifications
- **No websockets and no SSE. Everything is polling:**
  - order chat every 4 s (`components/orders/order-chat-panel.tsx`)
  - rider assignment offers every 5 s, or 30 s when push is on (`components/rider/assignment-gate.tsx`)
  - notification bell every 30 s
  - rider live map every 20 s
  - `lib/hooks/use-live-data.ts` for dashboards

  This works fine from a native app.
- **Web Push:** VAPID keys and the `web-push` library (`lib/services/push.ts`). The `PushSubscription` model stores browser endpoints, `public/sw.js` shows the alert, and `components/notifications/push-registrar.tsx` subscribes. iOS/Android native apps need **APNs/FCM** instead. `notifications.ts` → `push.ts` is the single sending point, so adding a second transport is contained.

## 7. Maps and browser APIs
- **Leaflet** is loaded lazily in the browser (`components/maps/leaflet-core.tsx`) by 6 map components (picker, shape editor, fleet map, rider live map). Tiles come from `NEXT_PUBLIC_MAP_TILE_URL`. It is DOM-based, so React Native needs a different map library or a WebView.
- **Geolocation:** `navigator.geolocation` in `lib/hooks/use-location-request.ts`, `components/maps/map-picker.tsx`, and `watchPosition` in `components/rider/location-tracker.tsx`. **Rider tracking stops when the browser tab is in the background.** A native app would need background location, which is a real gain.
- **Photos:** a plain `<input type="file">` (`components/ui/image-upload.tsx`, chat panel). All resizing happens on the server with `sharp`. There are smaller browser-only pieces too: `localStorage`/cookies (cart, theme, locale, browse scope), sounds (`lib/sound`) and vibration.

## 8. Build, deploy, tests
- Scripts: `dev`/`build` (webpack), `start`, `lint`, `check:i18n`, `seed`, `db:*`, `test:unit` (7 `tests/*.test.mts`, node:test), and `test:e2e*` (86 Playwright specs, one worker, against `prisma/test.db`). `postinstall` runs `prisma generate`.
- **No CI at all** (no `.github`, no Dockerfile, no Vercel config). Deploy is manual: PM2 + Nginx on a Linux VPS. Windows runs through `setup.bat`/`start.bat`.
- **Monorepo split: medium.** Moving files is easy because of the `@/` alias, but a lot of code depends on each other. The three biggest obstacles:
  1. **Auth is cookie-only.** Bearer-token login has to be added before any native client works.
  2. **About 100 server-component pages query Prisma directly.** Their data has no API yet, and the UI is DOM + Tailwind, so it cannot be reused in React Native.
  3. **Services are tied to Next and to one machine:** `lib/http/errors` (`NextResponse`), `after()`, `next/cache`, local disk uploads, SQLite and in-memory limits.

## Verdict
**Move first into `packages/shared`:** the 43 pure files (validation, hours, coverage geometry, policies, constants/enums, i18n dictionaries + `messages/`, `types/`). They have no dependencies, they already have unit tests, and every app needs them. **Next:** split `ApiError` away from `NextResponse` so `lib/services` + Prisma can become `packages/core`. **Leave in the web app:** all of `app/`, `components/`, `proxy.ts`, Auth.js wiring, Leaflet maps, the service worker, and the theme/sound/cookie helpers. **Before any mobile work:** add token auth, a Postgres + object-storage path, and an API for the screens that today read the database directly. For desktop, wrapping the hosted web app (Tauri/Electron) is the cheapest route because it reuses everything.
