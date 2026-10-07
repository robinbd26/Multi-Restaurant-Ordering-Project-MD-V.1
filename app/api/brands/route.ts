import { requireApiRole, requireApproved } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { parseBody } from "@/lib/http/form";
import { created, json } from "@/lib/http/respond";
import { activeBrands, allBrands, assignableBrands, createBrand, serializeBrand } from "@/lib/services/brands";

// GET /api/brands — the brand list, scoped by role:
//   super admin           → every brand, archived included (?scope=all default);
//   other staff           → every non-archived brand (branch managers SEE brands,
//                           they never manage them — every write below is
//                           super-admin only, enforced here and in the service);
//   customers / riders    → live brands only.
export const GET = handle(async () => {
  const me = await requireApproved();
  const results =
    me.role === "super_admin"
      ? await allBrands()
      : me.role === "customer" || me.role === "rider"
        ? await activeBrands()
        : await assignableBrands();
  return json({ results, count: results.length });
});

// POST /api/brands — super admin creates a brand (multipart: fields + optional `logo`).
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("super_admin");
  const { fields, file } = await parseBody(req);
  const brand = await createBrand(me, fields, file("logo"));
  return created(serializeBrand(brand));
});
