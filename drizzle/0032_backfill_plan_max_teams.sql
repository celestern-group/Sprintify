-- Custom SQL migration file, put your code below! --

-- 0025 added "maxTeams" with no default and no backfill, so plans seeded
-- before it (free/basic/premium/enterprise from 0009, or a pre-existing
-- "Free" plan that 0030's ON CONFLICT DO NOTHING left untouched) still have
-- "maxTeams" NULL, i.e. unlimited teams. Mirror the maxOrganizations tiering
-- from 0012 (1 / 3 / 10 / unlimited) for any plan still unset.
UPDATE "plan" SET "maxTeams" = 1 WHERE "id" = 'free' AND "maxTeams" IS NULL;
UPDATE "plan" SET "maxTeams" = 3 WHERE "id" = 'basic' AND "maxTeams" IS NULL;
UPDATE "plan" SET "maxTeams" = 10 WHERE "id" = 'premium' AND "maxTeams" IS NULL;
-- enterprise stays NULL (unlimited) — matches its maxOrganizations/maxProjects/maxMembers.
