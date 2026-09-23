# Map-based delivery coverage — plan

Goal: the customer's pin (lat/lng) is the source of truth for delivery. Each branch
draws delivery areas as shapes on a map; a pin inside an active shape is deliverable.
Street/area names become display text only. Maps move from Google to
OpenStreetMap + Leaflet; search/reverse geocoding move to Barikoi (server side only).

## What the survey found (changes to the brief)

- **Order snapshots are already safe.** `Order` stores `deliveryAddress` (text),
  `deliveryLat/Lng`, `deliveryAreaName/Charge/EstimateMinutes` as copies. The links
  `customerAddressId` and `deliveryAreaId` are `onDelete: SetNull` and nothing reads
  the relations back. Real delete of areas/addresses cannot break orders; no
  order-side fix is needed. (Migration still NULLs the address links explicitly.)
- **Branches already have `latitude/longitude`, but nullable, and most local branches
  have NULL** (6 of 8 on Ash's DB). Making the DB column NOT NULL would force us to
  invent coordinates. Decision: keep the columns nullable, enforce "required" in the
  form, API and service on every create/edit, and treat a branch with no location as
  "not covering anything" (flagged in the branch list) until a pin is dropped.
- **Existing delivery areas have no geometry** (106 of 108 rows on Ash's DB have no
  centre) and SQLite here has no trig functions, so a faithful shape cannot be
  generated in SQL. Decision: `shape` is a nullable column; a row without a shape
  covers nothing and is shown as "Draw the area". No fabricated circles.
- **Two other geometry systems exist and are folded in:** `BranchDeliveryZone`
  (circles, edited on the manager's "Delivery Zone" page) and the branch radius as a
  coverage circle. Both are retired from coverage — only area shapes cover. The
  radius becomes the max-coverage limit and the default starting circle. The circle
  table is left in place (data kept), just unused; the editor for it is removed.
- **Cart/branch rules** already live in `customer-branch.ts` (browsing branch wins if
  it covers the point, else nearest covered-and-open), `orders.ts` (`servingBranchForCart`
  = cart's branch, 4–11am platform closure, night last-order). We keep that structure
  and only change what "covers" means.
- `MapPicker` (draggable pin + search + GPS) already exists with three call sites; it
  is rewritten on Leaflet with the same props so callers keep working.

## Phases (one commit per concern inside each)

1. **Geocoding + Leaflet foundation**
   - Barikoi search/reverse in `lib/services/geo.ts`, behind existing `/api/geo/*`
     routes (POST, per-user rate limit), plus an in-memory cache and client debounce.
     No key / failure → empty results, app still works with pin + typed address.
   - `docs/integrations.md`, `.env.example` (Barikoi note, tile vars, Google vars removed).
   - Leaflet components (SSR-safe via `next/dynamic` in client wrappers), tile URL and
     attribution from env, CSP derived from the tile env var.
   - Move MapPicker, rider fleet map, live map, branch location panel, rider embeds;
     delete `use-google-maps`, `google-maps-types`, all Google env vars.
2. **Schema + migration** (one migration, tested on a scratch copy of `dev.db`)
   - `BranchDeliveryArea.shape` (nullable GeoJSON text); drop `localityId` and the
     `DeliveryLocality` table (Zones kept).
   - `CustomerAddress.latitude/longitude` NOT NULL after deleting coordinate-less rows
     (order links NULLed first).
   - `Branch` delivery-pause columns.
3. **Coverage engine** — pure, unit-testable modules under `lib/coverage/` (point in
   polygon, circle→polygon, shape validation, shift filter, held areas, overlap pick,
   nearest open branch), then rewire `delivery.ts`, `address-coverage.ts`,
   `customer-location.ts`, `customer-branch.ts`, `orders.ts` and the coverage APIs to it.
   Remove `locality-coverage.ts` and the master-area services.
4. **Branch form** — required map pin, radius as "max coverage", Zone help text
   (no more "Suggest areas").
5. **Delivery areas as shapes** — service + API (create/edit/hold/resume/delete, all
   written to Activity Logs), shape drawing editor, radius-limit check, list/form
   updates, super-admin overview map, manager Pause Delivery, remove master area list +
   Suggest panel + `/api/area-localities`.
6. **Customer address flow** — consent card → GPS → pin; address form with map +
   Barikoi search + reverse geocode prefill; live coverage badge; coordinates required;
   5-address cap and one-time checkout address use the pin.
7. **Order / rider / branch-manager views** — small map + "Open in Google Maps" link
   wherever an order's delivery address shows.
8. **Docs + tests + verification** — update old docs (incl. the Bangla one), unit tests
   (`npm run test:unit`), `tsc`, `eslint` on touched files, `npm run build`.
