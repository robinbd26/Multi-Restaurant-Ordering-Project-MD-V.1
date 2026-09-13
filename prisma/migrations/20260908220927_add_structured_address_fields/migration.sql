-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CustomerAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "customLabel" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "latitude" DECIMAL,
    "longitude" DECIMAL,
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
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CustomerAddress" ("address", "area", "city", "country", "createdAt", "customLabel", "id", "instructions", "isActive", "isDefault", "label", "latitude", "longitude", "postalCode", "updatedAt", "userId") SELECT "address", "area", "city", "country", "createdAt", "customLabel", "id", "instructions", "isActive", "isDefault", "label", "latitude", "longitude", "postalCode", "updatedAt", "userId" FROM "CustomerAddress";
DROP TABLE "CustomerAddress";
ALTER TABLE "new_CustomerAddress" RENAME TO "CustomerAddress";
CREATE INDEX "CustomerAddress_userId_idx" ON "CustomerAddress"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
