# Third-party integrations

## Barikoi — address search and pin-to-address lookup

| | |
|---|---|
| **Account owner** | AshMd (the Barikoi account belongs to Ash, not to the company or Robin) |
| **Dashboard** | https://developer.barikoi.com |
| **Plan** | Free tier, created September 2026 |
| **Key** | `BARIKOI_API_KEY` — server-side only |

### What uses it

Only two things, both display convenience:

1. **Search box** on the address map (customer addresses, checkout one-time address,
   branch location pin): typing "House 25 Road 11 Banani" suggests places.
   `POST /api/geo/search` → Barikoi *Autocomplete*.
2. **Pin → address text**: when the pin is moved, `POST /api/geo/reverse` → Barikoi
   *Reverse Geocode* fills the address box.

Both live in `lib/services/geocoding.ts`.

**Delivery coverage never depends on Barikoi.** Coverage is decided by the customer's
pin against the shapes each branch drew (`lib/coverage/`). Barikoi only supplies text.

### Where the key lives

- `.env` (Prisma CLI) and `.env.local` (Next.js runtime) **on each developer machine**
  (Ash, Robin). It is gitignored; `.env.example` lists the name only.
- The production server's environment later. Never commit the key and never expose it to
  the browser: it has no `NEXT_PUBLIC_` prefix, and the browser only calls our own
  `/api/geo/*` routes.
- To share the key with Robin, send it privately; it is not in the repo.

### Protecting the free quota

- The client waits 450 ms after typing stops and needs 3+ characters before searching.
- The API routes are rate limited per signed-in user (40 searches / 60 reverse lookups
  per minute).
- Results are cached in server memory (searches 10 min, pin lookups 1 h on a ~11 m
  grid); identical in-flight requests share one upstream call.
- If Barikoi answers 401/402/403/429 (bad key, quota used up), the server stops calling
  it for 5 minutes instead of retrying on every keystroke.

### If the key is missing or the quota runs out

Nothing breaks. Search returns no suggestions and pin lookups return no text; the
customer can still tap the map, drag the pin and type the address by hand, and delivery
coverage works exactly the same because it only uses the pin. Branch managers can still
drop the branch pin the same way. To restore search: top up / upgrade the Barikoi plan
from the dashboard above, or wait for the free quota to reset. Check the server log for
`[geo] Barikoi refused the request`.

## Map tiles — OpenStreetMap (Leaflet)

Maps are drawn with Leaflet. Tiles default to the public OpenStreetMap server, which has
a [usage policy](https://operations.osmfoundation.org/policies/tiles/) and no uptime
guarantee, so **switch to a tile provider before real traffic**. This needs no code
change: set `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` (both public,
never secrets) and rebuild. The Content-Security-Policy allows the tile host taken from
that variable.

The public Nominatim service is deliberately **not** used: its policy forbids
autocomplete and commercial-scale use.

## Google Maps

Not used any more. "Open in Google Maps" buttons are plain URL links built from
coordinates (no API key, no SDK).
