-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DeliveryLocality" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "zoneId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryLocality_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BranchDeliveryArea" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isHeld" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT NOT NULL DEFAULT '',
    "estimatedDeliveryMinutes" INTEGER NOT NULL DEFAULT 45,
    "deliveryCharge" DECIMAL NOT NULL DEFAULT 0,
    "centerLat" DECIMAL,
    "centerLng" DECIMAL,
    "localityId" INTEGER,
    "coverageWindow" TEXT NOT NULL DEFAULT 'both',
    "updatedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BranchDeliveryArea_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BranchDeliveryArea_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "DeliveryLocality" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BranchDeliveryArea" ("branchId", "centerLat", "centerLng", "createdAt", "deliveryCharge", "estimatedDeliveryMinutes", "holdReason", "id", "isActive", "isHeld", "name", "normalizedName", "updatedAt", "updatedById") SELECT "branchId", "centerLat", "centerLng", "createdAt", "deliveryCharge", "estimatedDeliveryMinutes", "holdReason", "id", "isActive", "isHeld", "name", "normalizedName", "updatedAt", "updatedById" FROM "BranchDeliveryArea";
DROP TABLE "BranchDeliveryArea";
ALTER TABLE "new_BranchDeliveryArea" RENAME TO "BranchDeliveryArea";
CREATE INDEX "BranchDeliveryArea_branchId_idx" ON "BranchDeliveryArea"("branchId");
CREATE INDEX "BranchDeliveryArea_localityId_idx" ON "BranchDeliveryArea"("localityId");
CREATE UNIQUE INDEX "BranchDeliveryArea_branchId_normalizedName_coverageWindow_key" ON "BranchDeliveryArea"("branchId", "normalizedName", "coverageWindow");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_normalizedName_key" ON "DeliveryZone"("normalizedName");

-- CreateIndex
CREATE INDEX "DeliveryLocality_zoneId_idx" ON "DeliveryLocality"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryLocality_zoneId_normalizedName_key" ON "DeliveryLocality"("zoneId", "normalizedName");
