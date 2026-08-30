-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'customer',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "dateOfBirth" DATETIME,
    "gender" TEXT NOT NULL DEFAULT '',
    "profilePhoto" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "isSuperuser" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" INTEGER,
    "approvedAt" DATETIME,
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "dateJoined" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT NOT NULL DEFAULT '',
    "currentLat" DECIMAL,
    "currentLng" DECIMAL,
    "currentAccuracy" DECIMAL,
    "locationUpdatedAt" DATETIME,
    "currentLocationSource" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "User_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("address", "approvedAt", "approvedById", "blockedReason", "createdAt", "currentAccuracy", "currentLat", "currentLng", "dateJoined", "dateOfBirth", "email", "firstName", "gender", "id", "isActive", "isBlocked", "isStaff", "isSuperuser", "lastName", "locationUpdatedAt", "notificationsEnabled", "password", "phone", "profilePhoto", "rejectionReason", "role", "status", "updatedAt", "username") SELECT "address", "approvedAt", "approvedById", "blockedReason", "createdAt", "currentAccuracy", "currentLat", "currentLng", "dateJoined", "dateOfBirth", "email", "firstName", "gender", "id", "isActive", "isBlocked", "isStaff", "isSuperuser", "lastName", "locationUpdatedAt", "notificationsEnabled", "password", "phone", "profilePhoto", "rejectionReason", "role", "status", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_status_idx" ON "User"("status");
CREATE INDEX "User_phone_idx" ON "User"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
