-- "No hours set" now means CLOSED to customers (lib/hours/availability.ts).
-- Until this release it meant "takes orders at any time", so a brand at a live
-- branch that never got a schedule is open around the clock TODAY. To not close
-- anything that is open today, every such brand gets an explicit all-day
-- schedule (00:00 to 00:00 = 24 hours, delivery and pickup), which is exactly
-- what it does now. Managers then see real hours they can narrow, instead of a
-- branch that silently went dark.
--
-- Only rows that are effectively unset are touched: empty, not valid JSON, or
-- JSON without an "everyDay" list (the app reads all three as "not set").
-- Archived or deactivated branches and inactive/archived brands are skipped:
-- they are not open today, so the new rule changes nothing for them.
-- Re-running changes nothing (a filled row no longer matches).
UPDATE "BranchBrand"
SET "hours" = '{"everyDay":[{"start":"00:00","end":"00:00","delivery":true,"pickup":true}],"days":{}}'
WHERE (
        "hours" IS NULL
     OR TRIM("hours") = ''
     OR json_valid("hours") = 0
     OR json_type("hours", '$.everyDay') IS NOT 'array'
  )
  AND "branchId" IN (SELECT "id" FROM "Branch" WHERE "isActive" = 1 AND "isArchived" = 0)
  AND "brandId" IN (SELECT "id" FROM "Brand" WHERE "isActive" = 1 AND "isArchived" = 0);
