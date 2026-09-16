import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { created, json } from "@/lib/http/respond";
import { createZone, zonesForAdmin } from "@/lib/services/area-master-admin";

// GET /api/area-zones — the whole master list, including inactive rows.
// Super admin only: this is the platform-wide list every branch picks from.
export const GET = handle(async () => {
  await requireApiRole("super_admin");
  const zones = await zonesForAdmin();
  return json({ results: zones, count: zones.length });
});

// POST /api/area-zones — add a zone to the master list.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("super_admin");
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const zone = await createZone(me, body.name);
  return created({ id: zone.id, name: zone.name, is_active: zone.isActive });
});
