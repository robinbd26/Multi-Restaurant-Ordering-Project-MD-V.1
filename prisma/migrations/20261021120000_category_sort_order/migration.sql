-- Category.sortOrder: the storefront order of category chips and menu sections.
-- The menu used to sort categories alphabetically, which opened a pizza brand's
-- menu with Appetizers and Carbonated Beverages.
--
-- Safe on anyone's data: the column is added with a default, every existing row
-- is backfilled, and a category this file does not know (an admin-made one) gets
-- rank 100, so it lands after the ranked ones, alphabetically among its peers.
ALTER TABLE "Category" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 100;

UPDATE "Category" SET "sortOrder" = CASE "name"
  WHEN 'Classic Pizzas' THEN 1
  WHEN 'Gourmet Pizzas' THEN 2
  WHEN 'More For Less Pizzas' THEN 3
  WHEN 'Pizza Boats' THEN 4
  WHEN 'Pizza Combos' THEN 5
  WHEN 'Pasta' THEN 6
  WHEN 'Appetizers' THEN 7
  WHEN 'Soups' THEN 8
  WHEN 'Drinks' THEN 9
  WHEN 'Carbonated Beverages' THEN 10
  ELSE 100 END
WHERE "brand" = 'cheez';

UPDATE "Category" SET "sortOrder" = CASE "name"
  WHEN 'Classic Burgers' THEN 1
  WHEN 'Gourmet Burgers' THEN 2
  WHEN 'Crispy Chicken' THEN 3
  WHEN 'Wraps' THEN 4
  WHEN 'Rice Meals' THEN 5
  WHEN 'Poutines' THEN 6
  WHEN 'Teasers' THEN 7
  WHEN 'Burger Extras' THEN 8
  WHEN 'Fries' THEN 9
  WHEN 'Sauces' THEN 10
  WHEN 'Desserts' THEN 11
  WHEN 'Shakes' THEN 12
  WHEN 'Mocktails' THEN 13
  WHEN 'Carbonated Beverages' THEN 14
  ELSE 100 END
WHERE "brand" = 'madchef';
