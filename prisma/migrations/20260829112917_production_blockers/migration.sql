-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "requestedIp" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "coins" INTEGER NOT NULL,
    "tkValue" DECIMAL NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "consumedOrderId" INTEGER,
    "consumedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "couponId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Coupon_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Coupon" ("code", "createdAt", "createdById", "discountType", "endsAt", "id", "isActive", "maxUses", "minOrder", "startsAt", "updatedAt", "usedCount", "value") SELECT "code", "createdAt", "createdById", "discountType", "endsAt", "id", "isActive", "maxUses", "minOrder", "startsAt", "updatedAt", "usedCount", "value" FROM "Coupon";
DROP TABLE "Coupon";
ALTER TABLE "new_Coupon" RENAME TO "Coupon";
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNumber" TEXT,
    "customerId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "riderId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "idempotencyKey" TEXT,
    "bkashTransactionId" TEXT NOT NULL DEFAULT '',
    "bkashPayerPhone" TEXT NOT NULL DEFAULT '',
    "bkashDestinationNumber" TEXT NOT NULL DEFAULT '',
    "paymentSubmittedAt" DATETIME,
    "paymentVerifiedById" INTEGER,
    "paymentVerifiedAt" DATETIME,
    "paymentRejectionReason" TEXT NOT NULL DEFAULT '',
    "gatewayName" TEXT NOT NULL DEFAULT '',
    "gatewayPaymentId" TEXT NOT NULL DEFAULT '',
    "gatewayTrxId" TEXT NOT NULL DEFAULT '',
    "gatewayStatus" TEXT NOT NULL DEFAULT '',
    "paidAmount" DECIMAL,
    "gatewayRawPayload" TEXT NOT NULL DEFAULT '',
    "totalAmount" DECIMAL NOT NULL DEFAULT 0,
    "couponId" INTEGER,
    "discountAmount" DECIMAL NOT NULL DEFAULT 0,
    "coinsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "coinDiscountAmount" DECIMAL NOT NULL DEFAULT 0,
    "foodNotes" TEXT NOT NULL DEFAULT '',
    "prepTimeSnapshot" INTEGER,
    "fulfillmentType" TEXT NOT NULL DEFAULT 'delivery',
    "deliveryLat" DECIMAL,
    "deliveryLng" DECIMAL,
    "deliveryCoordSource" TEXT NOT NULL DEFAULT '',
    "customerAddressId" INTEGER,
    "deliveryAddress" TEXT NOT NULL,
    "deliveryAreaId" INTEGER,
    "deliveryAreaName" TEXT NOT NULL DEFAULT '',
    "deliveryCharge" DECIMAL NOT NULL DEFAULT 0,
    "deliveryEstimateMinutes" INTEGER,
    "deliveryDistanceKm" DECIMAL,
    "deliveryRadiusKmSnapshot" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_customerAddressId_fkey" FOREIGN KEY ("customerAddressId") REFERENCES "CustomerAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_deliveryAreaId_fkey" FOREIGN KEY ("deliveryAreaId") REFERENCES "BranchDeliveryArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("bkashDestinationNumber", "bkashPayerPhone", "bkashTransactionId", "branchId", "couponId", "createdAt", "customerId", "deliveryAddress", "deliveryAreaId", "deliveryAreaName", "deliveryCharge", "deliveryDistanceKm", "deliveryEstimateMinutes", "deliveryLat", "deliveryLng", "deliveryRadiusKmSnapshot", "discountAmount", "foodNotes", "fulfillmentType", "id", "idempotencyKey", "orderNumber", "paymentMethod", "paymentRejectionReason", "paymentStatus", "paymentSubmittedAt", "paymentVerifiedAt", "paymentVerifiedById", "prepTimeSnapshot", "riderId", "status", "totalAmount", "updatedAt") SELECT "bkashDestinationNumber", "bkashPayerPhone", "bkashTransactionId", "branchId", "couponId", "createdAt", "customerId", "deliveryAddress", "deliveryAreaId", "deliveryAreaName", "deliveryCharge", "deliveryDistanceKm", "deliveryEstimateMinutes", "deliveryLat", "deliveryLng", "deliveryRadiusKmSnapshot", "discountAmount", "foodNotes", "fulfillmentType", "id", "idempotencyKey", "orderNumber", "paymentMethod", "paymentRejectionReason", "paymentStatus", "paymentSubmittedAt", "paymentVerifiedAt", "paymentVerifiedById", "prepTimeSnapshot", "riderId", "status", "totalAmount", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE INDEX "Order_branchId_idx" ON "Order"("branchId");
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_riderId_idx" ON "Order"("riderId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_bkashTransactionId_idx" ON "Order"("bkashTransactionId");
CREATE INDEX "Order_gatewayPaymentId_idx" ON "Order"("gatewayPaymentId");
CREATE UNIQUE INDEX "Order_customerId_idempotencyKey_key" ON "Order"("customerId", "idempotencyKey");
CREATE TABLE "new_RamadanReservationPayment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reservationId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "method" TEXT NOT NULL DEFAULT 'demo',
    "gatewayRef" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "recordedById" INTEGER,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RamadanReservationPayment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "RamadanReservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RamadanReservationPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RamadanReservationPayment" ("amount", "branchId", "createdAt", "gatewayRef", "id", "idempotencyKey", "method", "paidAmount", "refundedAmount", "reservationId", "status", "updatedAt") SELECT "amount", "branchId", "createdAt", "gatewayRef", "id", "idempotencyKey", "method", "paidAmount", "refundedAmount", "reservationId", "status", "updatedAt" FROM "RamadanReservationPayment";
DROP TABLE "RamadanReservationPayment";
ALTER TABLE "new_RamadanReservationPayment" RENAME TO "RamadanReservationPayment";
CREATE UNIQUE INDEX "RamadanReservationPayment_reservationId_key" ON "RamadanReservationPayment"("reservationId");
CREATE UNIQUE INDEX "RamadanReservationPayment_idempotencyKey_key" ON "RamadanReservationPayment"("idempotencyKey");
CREATE INDEX "RamadanReservationPayment_branchId_status_idx" ON "RamadanReservationPayment"("branchId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_code_key" ON "RewardRedemption"("code");

-- CreateIndex
CREATE INDEX "RewardRedemption_userId_status_idx" ON "RewardRedemption"("userId", "status");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_customerId_idx" ON "CouponRedemption"("couponId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_orderId_key" ON "CouponRedemption"("couponId", "orderId");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");
