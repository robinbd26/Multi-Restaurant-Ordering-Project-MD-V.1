-- Product reviews: one per customer per product, photos, moderation.
--
-- Repairs existing rows BEFORE the new unique constraint (rule: never assume
-- clean data):
--   * duplicates: the old key was (orderId, productId), so one customer could
--     hold several reviews of the same product from different orders. Only the
--     NEWEST (highest id) per (customerId, productId) is kept; older ones are
--     dropped, since the new rule is "one review, edited over time".
--   * ratings outside 1..5 are clamped into range.
--   * branchId / brand are backfilled: branch from the product, brand from the
--     order line the review came from (OrderItem.brand), else the product's own
--     brand, else '' (sold under every brand of its branch).
--   * updatedAt starts equal to createdAt.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FoodReview" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "photos" TEXT NOT NULL DEFAULT '[]',
    "branchId" INTEGER,
    "brand" TEXT NOT NULL DEFAULT '',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" DATETIME,
    "hiddenById" INTEGER,
    "hiddenReason" TEXT NOT NULL DEFAULT '',
    "flaggedAt" DATETIME,
    "flaggedById" INTEGER,
    "flagReason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FoodReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FoodReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FoodReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FoodReview" (
    "id", "orderId", "productId", "customerId", "rating", "comment", "branchId", "brand", "createdAt", "updatedAt"
)
SELECT
    r."id",
    r."orderId",
    r."productId",
    r."customerId",
    MIN(MAX(COALESCE(r."rating", 5), 1), 5),
    COALESCE(r."comment", ''),
    p."branchId",
    COALESCE(
        NULLIF((SELECT oi."brand" FROM "OrderItem" oi
                 WHERE oi."orderId" = r."orderId" AND oi."productId" = r."productId"
                 ORDER BY oi."id" LIMIT 1), ''),
        p."brand",
        ''
    ),
    r."createdAt",
    r."createdAt"
FROM "FoodReview" r
LEFT JOIN "Product" p ON p."id" = r."productId"
WHERE r."id" IN (SELECT MAX("id") FROM "FoodReview" GROUP BY "customerId", "productId");
DROP TABLE "FoodReview";
ALTER TABLE "new_FoodReview" RENAME TO "FoodReview";
CREATE INDEX "FoodReview_productId_isHidden_idx" ON "FoodReview"("productId", "isHidden");
CREATE INDEX "FoodReview_branchId_idx" ON "FoodReview"("branchId");
CREATE UNIQUE INDEX "FoodReview_customerId_productId_key" ON "FoodReview"("customerId", "productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
