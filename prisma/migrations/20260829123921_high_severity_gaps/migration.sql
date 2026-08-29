-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "campaignId" INTEGER NOT NULL,
    "userId" INTEGER,
    "type" TEXT NOT NULL,
    "orderId" INTEGER,
    "metadata" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" DATETIME,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BranchEmployee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "employeeCode" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "photo" TEXT,
    "joiningDate" DATETIME,
    "department" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'waiter',
    "customRole" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "employmentStatus" TEXT NOT NULL DEFAULT 'active',
    "quitAt" DATETIME,
    "quitReason" TEXT NOT NULL DEFAULT '',
    "teamId" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "userId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BranchEmployee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BranchEmployee_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "EmployeeTeam" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BranchEmployee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BranchEmployee" ("branchId", "createdAt", "customRole", "department", "email", "employeeCode", "employmentStatus", "firstName", "id", "isActive", "joiningDate", "lastName", "notes", "phone", "photo", "quitAt", "quitReason", "role", "teamId", "updatedAt") SELECT "branchId", "createdAt", "customRole", "department", "email", "employeeCode", "employmentStatus", "firstName", "id", "isActive", "joiningDate", "lastName", "notes", "phone", "photo", "quitAt", "quitReason", "role", "teamId", "updatedAt" FROM "BranchEmployee";
DROP TABLE "BranchEmployee";
ALTER TABLE "new_BranchEmployee" RENAME TO "BranchEmployee";
CREATE UNIQUE INDEX "BranchEmployee_userId_key" ON "BranchEmployee"("userId");
CREATE INDEX "BranchEmployee_branchId_idx" ON "BranchEmployee"("branchId");
CREATE INDEX "BranchEmployee_branchId_role_idx" ON "BranchEmployee"("branchId", "role");
CREATE INDEX "BranchEmployee_branchId_employmentStatus_idx" ON "BranchEmployee"("branchId", "employmentStatus");
CREATE INDEX "BranchEmployee_teamId_idx" ON "BranchEmployee"("teamId");
CREATE UNIQUE INDEX "BranchEmployee_branchId_employeeCode_key" ON "BranchEmployee"("branchId", "employeeCode");
CREATE TABLE "new_Campaign" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'promotion',
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "couponId" INTEGER,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "conversionCount" INTEGER NOT NULL DEFAULT 0,
    "conversionRevenue" DECIMAL NOT NULL DEFAULT 0,
    "lastSentAt" DATETIME,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Campaign_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Campaign" ("couponId", "createdAt", "createdById", "description", "endsAt", "id", "isActive", "startsAt", "title", "type", "updatedAt") SELECT "couponId", "createdAt", "createdById", "description", "endsAt", "id", "isActive", "startsAt", "title", "type", "updatedAt" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE INDEX "Campaign_isActive_startsAt_idx" ON "Campaign"("isActive", "startsAt");
CREATE INDEX "Campaign_isArchived_idx" ON "Campaign"("isArchived");
CREATE TABLE "new_Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'system',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "titleKey" TEXT,
    "bodyKey" TEXT,
    "params" JSONB,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "noticeId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" INTEGER,
    "readAt" DATETIME,
    "clickedAt" DATETIME,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Notification" ("body", "bodyKey", "createdAt", "id", "isRead", "link", "noticeId", "params", "title", "titleKey", "type", "userId") SELECT "body", "bodyKey", "createdAt", "id", "isRead", "link", "noticeId", "params", "title", "titleKey", "type", "userId" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE INDEX "Notification_campaignId_idx" ON "Notification"("campaignId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_type_idx" ON "CampaignEvent"("campaignId", "type");

-- CreateIndex
CREATE INDEX "CampaignEvent_userId_idx" ON "CampaignEvent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "EmployeeAttendance_date_idx" ON "EmployeeAttendance"("date");
