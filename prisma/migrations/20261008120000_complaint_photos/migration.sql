-- Complaint photos: up to 5 storage keys as a JSON array. Additive with a
-- default, so every existing complaint simply has none.
ALTER TABLE "Complaint" ADD COLUMN "photos" TEXT NOT NULL DEFAULT '[]';
