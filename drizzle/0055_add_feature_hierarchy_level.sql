-- Insert a Feature level between Epic and Standard.
--
-- The hierarchy was 0 Sub-task / 1 Standard / 2 Epic; it becomes
-- 0 Sub-task / 1 Standard / 2 Feature / 3 Epic. 0054 already widened the CHECK
-- to 0..3, which has to land first — the UPDATE below writes a 3.
--
-- Two things happen here, in this order:
--   1. every type that sat at the old top level (2) moves up to 3, so an org's
--      existing Epic keeps meaning "the top of the tree" instead of silently
--      becoming a Feature. This is a rename of the number, not a re-levelling:
--      canParent() only compares levels, so every existing parent/child link
--      stays legal.
--   2. Feature is backfilled for every organization, mirroring
--      0044_seed_work_item_vocabulary.sql. Keep it in sync with
--      SEED_WORK_ITEM_TYPES in src/lib/work-items.ts — new orgs get their
--      catalog from there via the afterCreateOrganization hook.
UPDATE "workItemType" SET "hierarchyLevel" = 3, "updatedAt" = now() WHERE "hierarchyLevel" = 2;
--> statement-breakpoint
-- Make room in the picker ordering: everything below the top level slides down
-- one slot so Feature can sit directly under the epics. Position is a sort key,
-- not a unique column, so an org with a hand-tuned order degrades to a
-- name-alphabetical tie-break rather than an error.
UPDATE "workItemType" SET "position" = "position" + 1 WHERE "hierarchyLevel" < 3;
--> statement-breakpoint
INSERT INTO "workItemType" ("id", "organizationId", "key", "name", "description", "hierarchyLevel", "tone", "icon", "isDefault", "tracksDefect", "position", "source", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  o."id",
  'feature',
  'Feature',
  'A shippable capability inside an epic, delivered as a set of stories.',
  2,
  'amber',
  'IconFlag',
  false,
  false,
  (
    SELECT COALESCE(MAX(t."position"), -1) + 1
    FROM "workItemType" t
    WHERE t."organizationId" = o."id" AND t."hierarchyLevel" = 3
  ),
  'local',
  now(),
  now()
FROM "organization" o
ON CONFLICT DO NOTHING;
