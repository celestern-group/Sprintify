-- Custom SQL migration file, put your code below! --
INSERT INTO "plan" ("id", "name", "maxProjects", "maxMembers", "isDefault", "createdAt", "updatedAt")
VALUES
  ('free',       'Free',       5,    5,    true,  now(), now()),
  ('basic',      'Basic',      20,   20,   false, now(), now()),
  ('premium',    'Premium',    100,  100,  false, now(), now()),
  ('enterprise', 'Enterprise', NULL, NULL, false, now(), now());
--> statement-breakpoint
UPDATE "organization"
SET "planId" = "organization"."plan"
WHERE "organization"."plan" IN ('free', 'basic', 'premium', 'enterprise');
--> statement-breakpoint
UPDATE "organization" SET "planId" = 'free' WHERE "planId" IS NULL;
