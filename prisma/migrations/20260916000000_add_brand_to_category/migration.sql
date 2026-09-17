-- AlterTable
-- Purely additive: nullable, no default, so every existing category row keeps
-- its current meaning (NULL = "serves both brands").
ALTER TABLE "Category" ADD COLUMN "brand" TEXT;

-- CreateIndex
CREATE INDEX "Category_brand_idx" ON "Category"("brand");
