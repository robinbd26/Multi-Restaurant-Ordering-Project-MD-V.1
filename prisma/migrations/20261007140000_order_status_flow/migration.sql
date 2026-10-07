-- Order status flow with rider-controlled statuses (Part 3 of the
-- brands/hours/statuses round). Data only; no schema change.
--
-- "delayed" stops being a status: a rider now ANNOUNCES a delay as an event on
-- the order and the order stays On the way. Every open order still sitting in
-- "delayed" moves to the closest matching status, "on_the_way" (it was always
-- the non-terminal detour of the delivery leg, returning to on_the_way or
-- delivered). Its history rows (OrderStatusEvent) are kept exactly as written.
--
-- Pickup orders keep "ready" and "delivered" as stored values; they are
-- LABELLED "Ready for collection" and "Collected" in the app, so no pickup row
-- needs rewriting and every report that counts completed sales stays correct.
-- Pickup orders that legacy flows left in "picked_up" or "on_the_way" (the old
-- code allowed it) are moved back to "ready", the last pickup step they had
-- genuinely reached, so they can be collected normally.
UPDATE "Order" SET "status" = 'on_the_way', "updatedAt" = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE "status" = 'delayed';

UPDATE "Order" SET "status" = 'ready', "updatedAt" = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE "fulfillmentType" = 'pickup' AND "status" IN ('picked_up', 'on_the_way', 'delayed');
