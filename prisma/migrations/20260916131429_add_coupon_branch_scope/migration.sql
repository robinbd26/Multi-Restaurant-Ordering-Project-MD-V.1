-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Coupon" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'percent',
    "value" DECIMAL NOT NULL,
    "minOrder" DECIMAL NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "perCustomerLimit" INTEGER,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "branchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Coupon_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Coupon_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Coupon" ("code", "createdAt", "createdById", "discountType", "endsAt", "id", "isActive", "isArchived", "maxUses", "minOrder", "perCustomerLimit", "startsAt", "updatedAt", "usedCount", "value") SELECT "code", "createdAt", "createdById", "discountType", "endsAt", "id", "isActive", "isArchived", "maxUses", "minOrder", "perCustomerLimit", "startsAt", "updatedAt", "usedCount", "value" FROM "Coupon";
DROP TABLE "Coupon";
ALTER TABLE "new_Coupon" RENAME TO "Coupon";
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_branchId_idx" ON "Coupon"("branchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
