# Staged: make Branch.zoneId NOT NULL

Deliberately NOT applied. Branch "Main Branch" (id 1) has no zone; SQLite would
refuse the copy (`NOT NULL constraint failed`) and the Prisma client would throw
on that row. The app already enforces the zone in the branch form and API.

Once every branch has a zone (Admin > Branches > Edit > Zone / Area):

1. In `prisma/schema.prisma`, on `model Branch`, change
       zoneId Int?                                   ->  zoneId Int
       zone   DeliveryZone? @relation(... SetNull)   ->  zone   DeliveryZone @relation(fields: [zoneId], references: [id], onDelete: Restrict)
2. `mkdir prisma/migrations/<timestamp>_branch_zone_required` and copy `migration.sql` into it.
3. `npx prisma migrate deploy && npx prisma generate` (stop the dev server first).
4. Delete this folder.

`onDelete` becomes Restrict: a zone that still has branches can no longer be deleted.
