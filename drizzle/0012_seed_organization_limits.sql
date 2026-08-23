-- Custom SQL migration file, put your code below! --
UPDATE "plan" SET "maxOrganizations" = 1 WHERE "id" = 'free';
UPDATE "plan" SET "maxOrganizations" = 3 WHERE "id" = 'basic';
UPDATE "plan" SET "maxOrganizations" = 10 WHERE "id" = 'premium';
UPDATE "plan" SET "maxOrganizations" = NULL WHERE "id" = 'enterprise';