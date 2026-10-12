-- Dine-in "last guest entry" time, display only ("Dine-in until 11:00 PM, last
-- entry 10:30 PM"). "HH:MM" on the Asia/Dhaka clock, or "" = not shown.
--
-- Safe on anyone's data: the column is added with a default, so every existing
-- branch gets "" (nothing shown, exactly what customers saw before). The UPDATE
-- below is the explicit backfill, kept so the intent is visible and so a row
-- written by some other path with a NULL can never reach the NOT NULL reader.
ALTER TABLE "Branch" ADD COLUMN "dineInLastEntry" TEXT NOT NULL DEFAULT '';

UPDATE "Branch" SET "dineInLastEntry" = '' WHERE "dineInLastEntry" IS NULL;
