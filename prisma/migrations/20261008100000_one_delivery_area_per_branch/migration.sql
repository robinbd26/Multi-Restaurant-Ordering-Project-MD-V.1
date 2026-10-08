-- One delivery area per branch, plus temporary exclusions.
--
-- DATA STEP (deliberate, per the product owner): every existing delivery area
-- was seeded / hand-made test data under the old "many named areas per branch"
-- model, so ALL of them are removed here, on every machine that runs this.
-- `npm run seed` then gives each seeded demo branch one sensible area; any other
-- branch delivers nowhere until its manager or the super admin draws its area.
--
-- What referenced an area, and how each is handled (checked before writing this):
--   * Order.deliveryAreaId: a SetNull provenance link. Orders keep their own
--     immutable snapshot (deliveryAreaName, deliveryCharge,
--     deliveryEstimateMinutes), so the link is cleared explicitly first and no
--     invoice changes.
--   * CustomerAddress: has NO area link (coverage is decided from the pin), so
--     saved addresses are untouched.
--   * Coupon / campaigns: no area link (marketing matches the order's snapshot
--     text, which is kept).
--
-- Safe to re-run on any data: the UPDATE and DELETE are unconditional and
-- idempotent, and the unique index is created only after the table is empty.

-- 1. Clear the provenance links (the snapshots on each order stay as they are).
UPDATE "Order" SET "deliveryAreaId" = NULL WHERE "deliveryAreaId" IS NOT NULL;

-- 2. Remove every old area.
DELETE FROM "BranchDeliveryArea";

-- 3. One area per branch from now on.
DROP INDEX IF EXISTS "BranchDeliveryArea_branchId_idx";
CREATE UNIQUE INDEX "BranchDeliveryArea_branchId_key" ON "BranchDeliveryArea"("branchId");

-- 4. Temporary exclusions laid over an area.
CREATE TABLE "DeliveryAreaExclusion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "areaId" INTEGER NOT NULL,
    "shape" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "endsAt" DATETIME,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryAreaExclusion_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "BranchDeliveryArea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DeliveryAreaExclusion_areaId_idx" ON "DeliveryAreaExclusion"("areaId");
