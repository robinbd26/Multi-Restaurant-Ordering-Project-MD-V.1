-- Map-based delivery coverage.
--
-- Coverage stops being "does the customer's typed area name appear on a seeded
-- master list?" and becomes "does the customer's pin fall inside a shape this
-- branch drew?".  This migration therefore has to REPAIR data, not just reshape
-- it, and it must survive any developer's database (ours differ on purpose).
--
-- What it does, in order:
--   1. saved addresses with no usable pin are deleted (old test data), after the
--      orders that reference them are detached and each affected customer is
--      left with a valid default address;
--   2. Branch gains the delivery-pause columns (additive, defaulted);
--   3. BranchDeliveryArea gains `shape` and loses the name-matching machinery
--      (normalizedName + its unique index, localityId, centerLat/centerLng);
--   4. every branch that has a pin gets ONE delivery area seeded from its own
--      delivery radius, and every BranchDeliveryZone circle becomes a delivery
--      area, so no branch silently loses the coverage it already had;
--   5. the retired tables (BranchDeliveryZone, DeliveryLocality) are dropped;
--   6. CustomerAddress.latitude/longitude become NOT NULL.
--
-- NOTHING is invented.  A delivery area that only ever had a name (or a bare
-- centroid with no radius) gets shape = NULL, which covers nothing and shows up
-- in the dashboard as "draw this area" — a shape made up for it would be a
-- coverage promise nobody made.

-- ── 1 · SAVED ADDRESSES MUST HAVE A PIN ─────────────────────────────────────
-- "No usable pin" is NULL, the 0,0 point (what an empty form field used to
-- coerce to) or anything off the globe.  An address outside Bangladesh is left
-- alone: it is a real point, it simply will not be inside anyone's coverage.

-- Detach orders first.  Order.customerAddressId is ON DELETE SET NULL, but this
-- runs with foreign keys deferred, and an order must keep its own immutable
-- deliveryAddress/deliveryLat/deliveryLng snapshot either way — the link is only
-- provenance.  Doing it explicitly means the outcome does not depend on which
-- PRAGMA state the migration runner happens to use.
UPDATE "Order" SET "customerAddressId" = NULL
WHERE "customerAddressId" IN (
    SELECT "id" FROM "CustomerAddress"
    WHERE "latitude" IS NULL OR "longitude" IS NULL
       OR ("latitude" = 0 AND "longitude" = 0)
       OR "latitude" < -90 OR "latitude" > 90
       OR "longitude" < -180 OR "longitude" > 180
);

DELETE FROM "CustomerAddress"
WHERE "latitude" IS NULL OR "longitude" IS NULL
   OR ("latitude" = 0 AND "longitude" = 0)
   OR "latitude" < -90 OR "latitude" > 90
   OR "longitude" < -180 OR "longitude" > 180;

-- A customer whose DEFAULT address was one of the deleted rows would be left
-- with addresses but no default, which the "where do we deliver?" lookup reads
-- as "no saved location at all".  Promote their oldest remaining active row.
UPDATE "CustomerAddress" SET "isDefault" = true
WHERE "id" IN (
    SELECT MIN(a."id") FROM "CustomerAddress" a
    WHERE a."isActive" = true
      AND NOT EXISTS (
          SELECT 1 FROM "CustomerAddress" d
          WHERE d."userId" = a."userId" AND d."isActive" = true AND d."isDefault" = true
      )
    GROUP BY a."userId"
);

-- ── 2-6 · TABLE RESHAPES ────────────────────────────────────────────────────
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Branch: delivery-pause columns.
CREATE TABLE "new_Branch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "latitude" DECIMAL,
    "longitude" DECIMAL,
    "zoneId" INTEGER NOT NULL,
    "deliveryRadiusKm" DECIMAL NOT NULL DEFAULT 3.0,
    "deliveryFee" DECIMAL NOT NULL DEFAULT 0,
    "brandType" TEXT NOT NULL DEFAULT 'combined',
    "businessType" TEXT NOT NULL DEFAULT 'dine_in',
    "prepTimeMinutes" INTEGER NOT NULL DEFAULT 30,
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pickupAddress" TEXT NOT NULL DEFAULT '',
    "pickupPhone" TEXT NOT NULL DEFAULT '',
    "bkashNumber" TEXT NOT NULL DEFAULT '',
    "bkashEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bkashInstructions" TEXT NOT NULL DEFAULT '',
    "managerId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "holdReason" TEXT NOT NULL DEFAULT '',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "archivedById" INTEGER,
    "isOnHold" BOOLEAN NOT NULL DEFAULT false,
    "deliveryPauseMode" TEXT NOT NULL DEFAULT '',
    "deliveryPausedUntil" DATETIME,
    "deliveryPausedAt" DATETIME,
    "deliveryPausedById" INTEGER,
    "holdStartedAt" DATETIME,
    "holdStartedById" INTEGER,
    "holdReleaseReason" TEXT NOT NULL DEFAULT '',
    "holdReleasedAt" DATETIME,
    "holdReleasedById" INTEGER,
    "openingTime" TEXT,
    "closingTime" TEXT,
    "logo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Branch_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Branch_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Branch" ("address", "archivedAt", "archivedById", "bkashEnabled", "bkashInstructions", "bkashNumber", "brandType", "businessType", "closingTime", "createdAt", "deliveryFee", "deliveryRadiusKm", "email", "holdReason", "holdReleaseReason", "holdReleasedAt", "holdReleasedById", "holdStartedAt", "holdStartedById", "id", "isActive", "isArchived", "isOnHold", "latitude", "logo", "longitude", "managerId", "name", "openingTime", "phone", "pickupAddress", "pickupEnabled", "pickupPhone", "prepTimeMinutes", "updatedAt", "zoneId") SELECT "address", "archivedAt", "archivedById", "bkashEnabled", "bkashInstructions", "bkashNumber", "brandType", "businessType", "closingTime", "createdAt", "deliveryFee", "deliveryRadiusKm", "email", "holdReason", "holdReleaseReason", "holdReleasedAt", "holdReleasedById", "holdStartedAt", "holdStartedById", "id", "isActive", "isArchived", "isOnHold", "latitude", "logo", "longitude", "managerId", "name", "openingTime", "phone", "pickupAddress", "pickupEnabled", "pickupPhone", "prepTimeMinutes", "updatedAt", "zoneId" FROM "Branch";
DROP TABLE "Branch";
ALTER TABLE "new_Branch" RENAME TO "Branch";

-- BranchDeliveryArea: + shape, − the name-matching columns and unique index.
CREATE TABLE "new_BranchDeliveryArea" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shape" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isHeld" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT NOT NULL DEFAULT '',
    "estimatedDeliveryMinutes" INTEGER NOT NULL DEFAULT 45,
    "deliveryCharge" DECIMAL NOT NULL DEFAULT 0,
    "coverageWindow" TEXT NOT NULL DEFAULT 'both',
    "updatedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BranchDeliveryArea_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BranchDeliveryArea" ("branchId", "coverageWindow", "createdAt", "deliveryCharge", "estimatedDeliveryMinutes", "holdReason", "id", "isActive", "isHeld", "name", "updatedAt", "updatedById") SELECT "branchId", "coverageWindow", "createdAt", "deliveryCharge", "estimatedDeliveryMinutes", "holdReason", "id", "isActive", "isHeld", "name", "updatedAt", "updatedById" FROM "BranchDeliveryArea";
DROP TABLE "BranchDeliveryArea";
ALTER TABLE "new_BranchDeliveryArea" RENAME TO "BranchDeliveryArea";
CREATE INDEX "BranchDeliveryArea_branchId_idx" ON "BranchDeliveryArea"("branchId");

-- ── 4 · KEEP THE COVERAGE THAT ALREADY EXISTED ──────────────────────────────
-- Until now a point was covered if it sat inside the branch's own radius OR
-- inside one of its BranchDeliveryZone circles.  Both are real circles an
-- operator configured, so both become real delivery areas rather than being
-- thrown away — otherwise this migration would take every branch offline for
-- delivery until somebody drew new shapes by hand.
--
-- Shape JSON is assembled as text because SQLite here has no trig functions, so
-- a polygon approximation cannot be built in SQL.  It does not need one: a
-- circle is stored AS a circle ({"type":"Circle"}), which is also exact rather
-- than an n-gon approximation of what the operator set.

-- 4a. One area per branch that has a pin, matching its delivery radius and its
--     branch-level delivery fee — precisely the old "inside the radius" rule.
INSERT INTO "BranchDeliveryArea" ("branchId", "name", "shape", "isActive", "isHeld", "holdReason", "estimatedDeliveryMinutes", "deliveryCharge", "coverageWindow", "createdAt", "updatedAt")
SELECT
    "id",
    'Branch delivery radius',
    '{"type":"Circle","coordinates":[' || CAST("longitude" AS TEXT) || ',' || CAST("latitude" AS TEXT) || '],"radiusKm":' || CAST("deliveryRadiusKm" AS TEXT) || '}',
    true,
    false,
    '',
    45,
    "deliveryFee",
    'both',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Branch"
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "deliveryRadiusKm" > 0;

-- 4b. Every named coverage circle becomes an area carrying its own charge. That
--     charge was previously dead (the order write path never billed a circle's
--     fee, only a branch fee or a named area's) — now that areas are the one
--     pricing rail, the number the operator typed is finally the number charged.
INSERT INTO "BranchDeliveryArea" ("branchId", "name", "shape", "isActive", "isHeld", "holdReason", "estimatedDeliveryMinutes", "deliveryCharge", "coverageWindow", "createdAt", "updatedAt")
SELECT
    "branchId",
    "name",
    '{"type":"Circle","coordinates":[' || CAST("centerLng" AS TEXT) || ',' || CAST("centerLat" AS TEXT) || '],"radiusKm":' || CAST("radiusKm" AS TEXT) || '}',
    "isActive",
    false,
    '',
    45,
    "deliveryFee",
    'both',
    "createdAt",
    CURRENT_TIMESTAMP
FROM "BranchDeliveryZone"
WHERE "centerLat" IS NOT NULL AND "centerLng" IS NOT NULL AND "radiusKm" > 0;

-- ── 5 · RETIRED TABLES ──────────────────────────────────────────────────────
-- BranchDeliveryZone: its circles now live as delivery areas (above).
-- DeliveryLocality: the master Sector-5 / Nikonjo-1 list existed ONLY so a typed
-- address name could be matched against coverage.  The zones themselves
-- (DeliveryZone) stay — they are still the branch's required grouping tag.
DROP INDEX IF EXISTS "BranchDeliveryZone_branchId_idx";
DROP TABLE "BranchDeliveryZone";
DROP INDEX IF EXISTS "DeliveryLocality_zoneId_normalizedName_key";
DROP INDEX IF EXISTS "DeliveryLocality_zoneId_idx";
DROP TABLE "DeliveryLocality";

-- ── 6 · CustomerAddress: the pin is mandatory ───────────────────────────────
CREATE TABLE "new_CustomerAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "customLabel" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "latitude" DECIMAL NOT NULL,
    "longitude" DECIMAL NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "mainArea" TEXT NOT NULL DEFAULT '',
    "subArea" TEXT NOT NULL DEFAULT '',
    "customArea" TEXT NOT NULL DEFAULT '',
    "roadLane" TEXT NOT NULL DEFAULT '',
    "customRoad" TEXT NOT NULL DEFAULT '',
    "housePlot" TEXT NOT NULL DEFAULT '',
    "flatNumber" TEXT NOT NULL DEFAULT '',
    "landmark" TEXT NOT NULL DEFAULT '',
    "mapAddress" TEXT NOT NULL DEFAULT '',
    "placeId" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CustomerAddress" ("address", "area", "city", "country", "createdAt", "customArea", "customLabel", "customRoad", "flatNumber", "housePlot", "id", "instructions", "isActive", "isDefault", "label", "landmark", "latitude", "longitude", "mainArea", "mapAddress", "placeId", "postalCode", "roadLane", "subArea", "updatedAt", "userId") SELECT "address", "area", "city", "country", "createdAt", "customArea", "customLabel", "customRoad", "flatNumber", "housePlot", "id", "instructions", "isActive", "isDefault", "label", "landmark", "latitude", "longitude", "mainArea", "mapAddress", "placeId", "postalCode", "roadLane", "subArea", "updatedAt", "userId" FROM "CustomerAddress";
DROP TABLE "CustomerAddress";
ALTER TABLE "new_CustomerAddress" RENAME TO "CustomerAddress";
CREATE INDEX "CustomerAddress_userId_idx" ON "CustomerAddress"("userId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
