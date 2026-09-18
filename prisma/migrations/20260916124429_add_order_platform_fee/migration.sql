-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "platformFee" DECIMAL NOT NULL DEFAULT 0,
    "coinsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "coinDiscountAmount" DECIMAL NOT NULL DEFAULT 0,
    "foodNotes" TEXT NOT NULL DEFAULT '',
    "prepTimeSnapshot" INTEGER,
    "fulfillmentType" TEXT NOT NULL DEFAULT 'delivery',
    "requestedPickupAt" DATETIME,
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
INSERT INTO "new_Order" ("bkashDestinationNumber", "bkashPayerPhone", "bkashTransactionId", "branchId", "coinDiscountAmount", "coinsRedeemed", "couponId", "createdAt", "customerAddressId", "customerId", "deliveryAddress", "deliveryAreaId", "deliveryAreaName", "deliveryCharge", "deliveryCoordSource", "deliveryDistanceKm", "deliveryEstimateMinutes", "deliveryLat", "deliveryLng", "deliveryRadiusKmSnapshot", "discountAmount", "foodNotes", "fulfillmentType", "gatewayName", "gatewayPaymentId", "gatewayRawPayload", "gatewayStatus", "gatewayTrxId", "id", "idempotencyKey", "orderNumber", "paidAmount", "paymentMethod", "paymentRejectionReason", "paymentStatus", "paymentSubmittedAt", "paymentVerifiedAt", "paymentVerifiedById", "prepTimeSnapshot", "requestedPickupAt", "riderId", "status", "totalAmount", "updatedAt") SELECT "bkashDestinationNumber", "bkashPayerPhone", "bkashTransactionId", "branchId", "coinDiscountAmount", "coinsRedeemed", "couponId", "createdAt", "customerAddressId", "customerId", "deliveryAddress", "deliveryAreaId", "deliveryAreaName", "deliveryCharge", "deliveryCoordSource", "deliveryDistanceKm", "deliveryEstimateMinutes", "deliveryLat", "deliveryLng", "deliveryRadiusKmSnapshot", "discountAmount", "foodNotes", "fulfillmentType", "gatewayName", "gatewayPaymentId", "gatewayRawPayload", "gatewayStatus", "gatewayTrxId", "id", "idempotencyKey", "orderNumber", "paidAmount", "paymentMethod", "paymentRejectionReason", "paymentStatus", "paymentSubmittedAt", "paymentVerifiedAt", "paymentVerifiedById", "prepTimeSnapshot", "requestedPickupAt", "riderId", "status", "totalAmount", "updatedAt" FROM "Order";
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
