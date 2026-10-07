-- Brands become data (Part 1 of the brands/hours/statuses round).
--
-- Before: a branch carried brandType = cheez | madchef | combined, and products
-- and categories carried a free "cheez"/"madchef" string checked against a
-- hardcoded list. After: a Brand table the super admin manages, BranchBrand rows
-- saying which brands a branch serves, and real foreign keys from
-- Product.brand / Category.brand to Brand.slug.
--
-- ZERO DATA LOSS, ON ANYONE'S DATA. Every step below repairs existing rows
-- BEFORE the constraint that needs them is created:
--   1. The two existing brands are inserted with the exact slugs already stored
--      on products and categories, so those values stay valid foreign keys.
--   2. Any OTHER brand value found in the data (the app never wrote one, but a
--      hand-edited database might hold one) becomes its own brand, named after
--      its slug, so no reference is dropped.
--   3. Every branch gets one BranchBrand row per brand it served: a single-
--      brand branch its brand; "combined" (or anything unrecognised) both.
--   4. A product with NO brand on a single-brand branch is pinned to that brand
--      explicitly, because NULL now means "every brand the branch serves" and a
--      later second brand must not pick those products up. The old "combined"
--      product value becomes NULL, which is exactly what it meant.
--   5. Only then are the tables rebuilt with the foreign keys and brandType
--      dropped (its whole meaning now lives in BranchBrand).
--   6. Each order line snapshots the brand it was sold under.

-- CreateTable
CREATE TABLE "Brand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "logo" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#e8192c',
    "description" TEXT NOT NULL DEFAULT '',
    "descriptionBn" TEXT NOT NULL DEFAULT '',
    "tagline" TEXT NOT NULL DEFAULT '',
    "taglineBn" TEXT NOT NULL DEFAULT '',
    "emoji" TEXT NOT NULL DEFAULT '🍽️',
    "showCrustGuide" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "archivedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BranchBrand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER NOT NULL,
    "brandId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BranchBrand_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BranchBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex (before the backfill: the slug is the FK target and must be unique)
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");
CREATE INDEX "Brand_isArchived_sortOrder_idx" ON "Brand"("isArchived", "sortOrder");
CREATE INDEX "BranchBrand_brandId_idx" ON "BranchBrand"("brandId");
CREATE UNIQUE INDEX "BranchBrand_branchId_brandId_key" ON "BranchBrand"("branchId", "brandId");

-- 1. The two brands that existed in code, with the content the homepage used.
-- DateTime columns hold epoch milliseconds in this SQLite database.
INSERT INTO "Brand" ("slug", "name", "nameBn", "logo", "accentColor", "description", "descriptionBn", "tagline", "taglineBn", "emoji", "showCrustGuide", "sortOrder", "isActive", "isArchived", "createdAt", "updatedAt") VALUES
  ('cheez', 'Cheez! Pizza', 'চিজ! পিৎজা', '/images/brand/cheez-logo.webp', '#f5a623',
   'Thick crust, thin crust, pasta, boats & more', 'থিক ক্রাস্ট, থিন ক্রাস্ট, পাস্তা, বোট ও আরও অনেক কিছু',
   'Pizza Specialist', 'পিৎজা স্পেশালিস্ট', '🍕', true, 0, true, false,
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('madchef', 'Madchef', 'ম্যাডশেফ', '/images/brand/madchef-logo.webp', '#e8192c',
   'Burgers, wraps, rice meals, poutines & more', 'বার্গার, র‍্যাপ, রাইস মিল, পুটিন ও আরও অনেক কিছু',
   'Gourmet Kitchen', 'গুরমে কিচেন', '🔥', false, 1, true, false,
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- 2. Any other brand value already in the data keeps existing, as its own brand.
INSERT INTO "Brand" ("slug", "name", "sortOrder", "createdAt", "updatedAt")
SELECT v, v, 100, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM (
  SELECT "brand" AS v FROM "Product"
  UNION SELECT "brand" FROM "Category"
  UNION SELECT "brandType" FROM "Branch"
)
WHERE v IS NOT NULL AND TRIM(v) <> '' AND v <> 'combined'
  AND v NOT IN (SELECT "slug" FROM "Brand");

-- 3. Which brands each branch serves: its own brand, or both for "combined".
INSERT INTO "BranchBrand" ("branchId", "brandId", "createdAt")
SELECT b."id", br."id", CAST(strftime('%s','now') AS INTEGER) * 1000
FROM "Branch" b
JOIN "Brand" br ON br."slug" = b."brandType";

INSERT INTO "BranchBrand" ("branchId", "brandId", "createdAt")
SELECT b."id", br."id", CAST(strftime('%s','now') AS INTEGER) * 1000
FROM "Branch" b
JOIN "Brand" br ON br."slug" IN ('cheez', 'madchef')
WHERE b."brandType" NOT IN (SELECT "slug" FROM "Brand");

-- 4. Pin brand-less products on single-brand branches; "combined" -> NULL.
UPDATE "Product"
SET "brand" = (SELECT b."brandType" FROM "Branch" b WHERE b."id" = "Product"."branchId")
WHERE ("brand" IS NULL OR TRIM("brand") = '')
  AND (SELECT b."brandType" FROM "Branch" b WHERE b."id" = "Product"."branchId") IN (SELECT "slug" FROM "Brand");
UPDATE "Product" SET "brand" = NULL WHERE "brand" = 'combined' OR TRIM("brand") = '';
UPDATE "Category" SET "brand" = NULL WHERE "brand" = 'combined' OR TRIM("brand") = '';

-- 5. RedefineTables (generated by prisma migrate diff)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
INSERT INTO "new_Branch" ("address", "archivedAt", "archivedById", "bkashEnabled", "bkashInstructions", "bkashNumber", "businessType", "closingTime", "createdAt", "deliveryFee", "deliveryPauseMode", "deliveryPausedAt", "deliveryPausedById", "deliveryPausedUntil", "deliveryRadiusKm", "email", "holdReason", "holdReleaseReason", "holdReleasedAt", "holdReleasedById", "holdStartedAt", "holdStartedById", "id", "isActive", "isArchived", "isOnHold", "latitude", "logo", "longitude", "managerId", "name", "openingTime", "phone", "pickupAddress", "pickupEnabled", "pickupPhone", "prepTimeMinutes", "updatedAt", "zoneId") SELECT "address", "archivedAt", "archivedById", "bkashEnabled", "bkashInstructions", "bkashNumber", "businessType", "closingTime", "createdAt", "deliveryFee", "deliveryPauseMode", "deliveryPausedAt", "deliveryPausedById", "deliveryPausedUntil", "deliveryRadiusKm", "email", "holdReason", "holdReleaseReason", "holdReleasedAt", "holdReleasedById", "holdStartedAt", "holdStartedById", "id", "isActive", "isArchived", "isOnHold", "latitude", "logo", "longitude", "managerId", "name", "openingTime", "phone", "pickupAddress", "pickupEnabled", "pickupPhone", "prepTimeMinutes", "updatedAt", "zoneId" FROM "Branch";
DROP TABLE "Branch";
ALTER TABLE "new_Branch" RENAME TO "Branch";
CREATE TABLE "new_Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "statusChangedById" INTEGER,
    "statusChangedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "brand" TEXT,
    CONSTRAINT "Category_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Category_brand_fkey" FOREIGN KEY ("brand") REFERENCES "Brand" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Category" ("branchId", "brand", "createdAt", "description", "id", "isActive", "name", "normalizedName", "statusChangedAt", "statusChangedById", "updatedAt") SELECT "branchId", "brand", "createdAt", "description", "id", "isActive", "name", "normalizedName", "statusChangedAt", "statusChangedById", "updatedAt" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE INDEX "Category_branchId_idx" ON "Category"("branchId");
CREATE INDEX "Category_normalizedName_idx" ON "Category"("normalizedName");
CREATE INDEX "Category_brand_idx" ON "Category"("brand");
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL DEFAULT '',
    "productImage" TEXT,
    "variationId" INTEGER,
    "variationName" TEXT NOT NULL DEFAULT '',
    "variationType" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL NOT NULL,
    "foodNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "ProductVariation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("foodNote", "id", "orderId", "productId", "productImage", "productName", "quantity", "unitPrice", "variationId", "variationName", "variationType") SELECT "foodNote", "id", "orderId", "productId", "productImage", "productName", "quantity", "unitPrice", "variationId", "variationName", "variationType" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" DECIMAL NOT NULL,
    "brand" TEXT,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "image" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "deactivationReason" TEXT NOT NULL DEFAULT '',
    "heldByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "preparationTime" INTEGER NOT NULL DEFAULT 20,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "variationType" TEXT NOT NULL DEFAULT 'THICK',
    "deletedAt" DATETIME,
    "deletedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_brand_fkey" FOREIGN KEY ("brand") REFERENCES "Brand" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("branchId", "brand", "categoryId", "createdAt", "deactivationReason", "deletedAt", "deletedById", "description", "discount", "heldByAdmin", "id", "image", "isAvailable", "isPopular", "isRecommended", "name", "preparationTime", "price", "updatedAt", "variationType") SELECT "branchId", "brand", "categoryId", "createdAt", "deactivationReason", "deletedAt", "deletedById", "description", "discount", "heldByAdmin", "id", "image", "isAvailable", "isPopular", "isRecommended", "name", "preparationTime", "price", "updatedAt", "variationType" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_branchId_idx" ON "Product"("branchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 6. Snapshot each order line's brand: the product's own brand, or the
-- branch's only brand; "" when the product was sold under several at once.
UPDATE "OrderItem"
SET "brand" = COALESCE(
  (SELECT p."brand" FROM "Product" p WHERE p."id" = "OrderItem"."productId" AND p."brand" IS NOT NULL),
  (SELECT MIN(br."slug") FROM "Order" o
     JOIN "BranchBrand" bb ON bb."branchId" = o."branchId"
     JOIN "Brand" br ON br."id" = bb."brandId"
   WHERE o."id" = "OrderItem"."orderId"
   GROUP BY o."id" HAVING COUNT(*) = 1),
  ''
);
