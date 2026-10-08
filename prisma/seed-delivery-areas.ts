import { Prisma, PrismaClient } from "@prisma/client";

/**
 * One sensible delivery area for each SEEDED demo branch (one area per branch
 * since 20261008100000): a circle around the branch pin, 5 km or the branch's
 * own maximum radius if that is smaller, ৳60, 45 minutes.
 *
 * Only fills what is missing: a branch that already has its area (drawn by a
 * manager, or by an earlier run) is left alone, and a branch without a map pin
 * is skipped (an area is measured from the pin). Branches that are not demo
 * branches are never touched; their managers draw their own.
 *
 * Runs as part of `npm run seed`, and on its own (no other demo data touched):
 *   npx tsx prisma/seed-delivery-areas.ts
 */
export const DEMO_BRANCH_NAMES = ["Main Branch", "Cheez Gulshan", "Madchef Dhanmondi"];
const DEFAULT_RADIUS_KM = 5;

export async function seedDefaultDeliveryAreas(prisma: PrismaClient): Promise<string[]> {
  const branches = await prisma.branch.findMany({
    where: { name: { in: DEMO_BRANCH_NAMES }, isArchived: false },
    include: { deliveryAreas: { select: { id: true } } },
  });
  const created: string[] = [];
  for (const branch of branches) {
    if (branch.deliveryAreas.length > 0) continue;
    if (branch.latitude == null || branch.longitude == null) continue;
    const radiusKm = Math.min(DEFAULT_RADIUS_KM, Number(branch.deliveryRadiusKm));
    if (!(radiusKm > 0)) continue;
    await prisma.branchDeliveryArea.create({
      data: {
        branchId: branch.id,
        name: branch.name,
        shape: JSON.stringify({
          type: "Circle",
          coordinates: [Number(branch.longitude), Number(branch.latitude)],
          radiusKm,
        }),
        isActive: true,
        estimatedDeliveryMinutes: 45,
        deliveryCharge: new Prisma.Decimal("60.00"),
      },
    });
    created.push(`${branch.name} (${radiusKm} km)`);
  }
  return created;
}

// Standalone: `npx tsx prisma/seed-delivery-areas.ts`
if (process.argv[1] && /seed-delivery-areas\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedDefaultDeliveryAreas(prisma)
    .then((created) => {
      console.log(created.length ? `✔ Delivery areas created: ${created.join(", ")}` : "✔ Delivery areas: nothing missing");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
