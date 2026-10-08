-- Drop the old label-only delivery time slots ("Lunch 12:00-15:00", ...).
-- They were never enforced anywhere: ordering hours have lived per brand on
-- BranchBrand.hours since 20261007130000, the slots' editor UI was removed in
-- that release, and the /api/branch-manager/time-slots routes that still wrote
-- them are removed together with this migration. Nothing else references the
-- table (no foreign key points at it; it only pointed at Branch).
-- On Ash's machine it held the 2 seeded demo rows only.
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "DeliveryTimeSlot";
PRAGMA foreign_keys=on;
