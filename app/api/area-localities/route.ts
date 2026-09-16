import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { created } from "@/lib/http/respond";
import { createLocality } from "@/lib/services/area-master-admin";

// POST /api/area-localities — add a locality to a zone on the master list.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("super_admin");
  const body = (await req.json().catch(() => ({}))) as {
    zone_id?: unknown;
    name?: unknown;
  };
  const locality = await createLocality(me, Number(body.zone_id), body.name);
  return created({
    id: locality.id,
    zone_id: locality.zoneId,
    name: locality.name,
    is_active: locality.isActive,
  });
});
