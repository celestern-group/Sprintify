-- Custom SQL migration file, put your code below! --

-- Self-served organizations were created with a NULL planId and inherited the
-- default plan (Free) at resolve time. Pin them to that plan explicitly so
-- flipping the default to "No plan" below doesn't change their limits.
UPDATE "organization"
SET "planId" = (SELECT "id" FROM "plan" WHERE "isDefault" = true LIMIT 1)
WHERE "planId" IS NULL;
--> statement-breakpoint
UPDATE "plan" SET "isDefault" = false WHERE "isDefault" = true;
--> statement-breakpoint
-- Zero-entitlement tier: users/orgs without an assigned plan can't create
-- anything. ON CONFLICT covers DBs already seeded by scripts/seed-admin.ts.
INSERT INTO "plan" ("id", "name", "maxProjects", "maxMembers", "maxOrganizations", "maxTeams", "limitMode", "isDefault", "createdAt", "updatedAt")
VALUES ('none', 'No plan', 0, 0, 0, 0, 'shared', false, now(), now())
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
UPDATE "plan" SET "isDefault" = true WHERE "name" = 'No plan';
