-- Product variants fix: the columns a single product with several sizes needs.
--
--   ProductVariation.dineInOnly  a size that is listed but never sold online
--                                (8" pizzas). isEnabled used to double as this,
--                                which hid the size from the menu entirely.
--   Product.ingredients          short "what's inside" chips, kept out of the
--                                description so About stays one sentence.
--   Product.isSpicy / isVegetarian  storefront badges.
--
-- Safe on anyone's data: every column is added with a default, so existing rows
-- read exactly as before (nothing dine-in only, no chips, no badges). The one
-- backfill marks the sizes the real-catalog seed already labelled "Dine-in only",
-- so they keep refusing online orders once they are shown again. It leaves
-- isEnabled alone; scripts/fix-product-variants.ts does the catalog repair.
ALTER TABLE "ProductVariation" ADD COLUMN "dineInOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "ingredients" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "isSpicy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "isVegetarian" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ProductVariation" SET "dineInOnly" = true
WHERE lower(trim("servingInfo")) IN ('dine-in only', 'dine in only');
