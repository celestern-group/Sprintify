-- Custom SQL migration file, put your code below! --

-- Invariant: an assignable "Free" tier always exists alongside the "No plan"
-- default (0029). On a DB seeded normally (0009) Free is already present and
-- this is a no-op; on DBs where the seed plans were removed it recreates it.
INSERT INTO "plan" ("id", "name", "maxProjects", "maxMembers", "maxOrganizations", "maxTeams", "limitMode", "isDefault", "createdAt", "updatedAt")
VALUES ('free', 'Free', 5, 5, 1, 1, 'shared', false, now(), now())
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- Existing organizations must never fall onto the zero-entitlement "No plan"
-- default: any org still lacking a plan (e.g. left NULL by an out-of-order
-- seed history) is pinned to Free so it stays functional. New users with no
-- organization still resolve to the "No plan" default and are blocked from
-- creating one — that path is unaffected here.
UPDATE "organization"
SET "planId" = (SELECT "id" FROM "plan" WHERE "name" = 'Free' LIMIT 1)
WHERE "planId" IS NULL;
