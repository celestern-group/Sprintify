-- Existing organizations already have a seeded "bug" type from
-- 0044_seed_work_item_vocabulary.sql, created before tracksDefect existed. The
-- column defaults to false, so without this those items would never show steps
-- to reproduce / expected / actual.
--
-- Keyed on the seeded KEY, not the name: only the rows this codebase itself
-- created can be assumed to mean "defect". A type someone renamed or invented
-- is left alone — the flag is theirs to set, and guessing from a name is
-- exactly what the flag exists to avoid.
UPDATE "workItemType"
SET "tracksDefect" = true
WHERE "key" = 'bug'
  AND "source" = 'local'
  AND "tracksDefect" = false;
