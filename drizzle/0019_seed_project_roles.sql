-- Seed the starting role catalog for every organization that already exists.
-- New organizations get the same set from the afterCreateOrganization hook; both
-- derive from SEED_PROJECT_ROLES in src/lib/project-permissions.ts, so keep them
-- in sync if the starting catalog ever changes.
--
-- CROSS JOIN covers every org without knowing their ids. gen_random_uuid() is
-- built into Postgres 13+. ON CONFLICT DO NOTHING (untargeted, since partial
-- unique indexes are awkward to name as inference targets) makes it re-runnable.
INSERT INTO "projectRole" ("id", "organizationId", "projectId", "key", "name", "description", "permissions", "isDefault", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", NULL, v.key, v.name, v.description, v.permissions::jsonb, v.is_default, 'local', now(), now()
FROM "organization" o
CROSS JOIN (VALUES
  (
    'product_owner',
    'Product owner',
    'Owns the backlog and the product direction.',
    '["project:view","project:update","member:view","member:manage","role:manage","backlog:view","backlog:prioritize","item:create","item:update","item:delete","item:assign"]',
    false
  ),
  (
    'scrum_master',
    'Scrum master',
    'Runs the process and keeps the team unblocked.',
    '["project:view","member:view","member:manage","role:manage","backlog:view","sprint:create","sprint:manage","item:update","item:assign"]',
    false
  ),
  (
    'developer',
    'Developer',
    'Delivers the work in the sprint.',
    '["project:view","member:view","backlog:view","item:create","item:update","item:assign"]',
    true
  ),
  (
    'viewer',
    'Viewer',
    'Read-only access to the project.',
    '["project:view","member:view","backlog:view"]',
    false
  )
) AS v(key, name, description, permissions, is_default)
ON CONFLICT DO NOTHING;
