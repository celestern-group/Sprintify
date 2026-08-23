-- Backfill roleId from the old role string before making it NOT NULL. Written
-- into the generated file (rather than a separate --custom migration) so the
-- drizzle snapshot stays in agreement with the schema — hand-written DDL that
-- drizzle doesn't know about gets re-emitted as a duplicate on the next
-- db:generate.
--
-- Match the old role name against the organization's catalog role of the same key.
-- pm."role" is matched in WHERE, not in the JOIN's ON clause: Postgres does not
-- expose the UPDATE target to a join condition inside the FROM list.
UPDATE "projectMember" pm
SET "roleId" = pr."id"
FROM "project" p
JOIN "projectRole" pr
  ON pr."organizationId" = p."organizationId"
 AND pr."projectId" IS NULL
WHERE p."id" = pm."projectId"
  AND pr."key" = pm."role"
  AND pm."roleId" IS NULL;--> statement-breakpoint
-- Anything whose old role string no longer maps to a catalog key lands on the
-- org default rather than blocking the NOT NULL below.
UPDATE "projectMember" pm
SET "roleId" = pr."id"
FROM "project" p
JOIN "projectRole" pr
  ON pr."organizationId" = p."organizationId"
 AND pr."isDefault" = true
WHERE p."id" = pm."projectId" AND pm."roleId" IS NULL;--> statement-breakpoint
ALTER TABLE "projectMember" ALTER COLUMN "roleId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projectMember" DROP COLUMN "role";
