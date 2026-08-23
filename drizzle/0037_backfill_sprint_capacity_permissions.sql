-- Grant the newly-enforced sprint and capacity permissions to the seeded roles
-- that already exist. SEED_PROJECT_ROLES in src/lib/project-permissions.ts now
-- lists these keys, but that only covers organizations created from here on —
-- existing orgs got their catalog from 0019_seed_project_roles.sql and would
-- otherwise be locked out of a feature their role clearly implies.
--
-- Appends rather than replaces: an organization may have edited these roles,
-- and overwriting the array would silently revoke whatever they added.
-- jsonb_agg(DISTINCT ...) dedupes, so re-running is a no-op.
--
-- Scoped to source='local' AND "projectId" IS NULL: synced roles belong to the
-- external system that owns them, and project-local roles were authored
-- deliberately by someone inside that project.
WITH additions(key, perms) AS (
  VALUES
    (
      'product_owner',
      '["sprint:view","sprint:create","sprint:manage","capacity:view","capacity:manage"]'::jsonb
    ),
    (
      'scrum_master',
      '["sprint:view","capacity:view","capacity:manage"]'::jsonb
    ),
    ('developer', '["sprint:view","capacity:view"]'::jsonb),
    ('viewer', '["sprint:view","capacity:view"]'::jsonb)
)
UPDATE "projectRole" r
SET
  "permissions" = (
    SELECT COALESCE(jsonb_agg(DISTINCT p), '[]'::jsonb)
    FROM jsonb_array_elements(r."permissions" || a.perms) AS p
  ),
  "updatedAt" = now()
FROM additions a
WHERE r."key" = a.key
  AND r."source" = 'local'
  AND r."projectId" IS NULL;
--> statement-breakpoint
-- Every organization gets one working-time calendar so projects have something
-- to inherit before an admin visits the calendars page. Deliberately empty —
-- we don't know the org's region, and guessing public holidays wrongly is
-- worse than showing none.
INSERT INTO "holidayCalendar" ("id", "organizationId", "name", "timezone", "isDefault", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Default', 'UTC', true, 'local', now(), now()
FROM "organization" o
ON CONFLICT DO NOTHING;
