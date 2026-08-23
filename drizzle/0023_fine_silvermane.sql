CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "rateLimit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failedVerificationCount" integer DEFAULT 0,
	"lockedUntil" timestamp
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" USING btree ("userId");--> statement-breakpoint
-- Deduplicate existing member rows before enforcing uniqueness on
-- (organizationId, userId). Keep the earliest membership per (org, user),
-- repoint its project memberships onto the survivor, then remove duplicates.
UPDATE "projectMember" pm
SET "memberId" = d.keeper_id
FROM (
  SELECT "id" AS loser_id, first_value("id") OVER w AS keeper_id
  FROM (
    SELECT "id", "organizationId", "userId", "createdAt",
      row_number() OVER (PARTITION BY "organizationId", "userId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
    FROM "member"
  ) ranked
  WINDOW w AS (PARTITION BY "organizationId", "userId" ORDER BY "createdAt" ASC, "id" ASC)
) d
WHERE pm."memberId" = d.loser_id
  AND d.loser_id <> d.keeper_id
  AND NOT EXISTS (
    SELECT 1 FROM "projectMember" x
    WHERE x."projectId" = pm."projectId" AND x."memberId" = d.keeper_id
  );--> statement-breakpoint
-- Drop project memberships still pointing at a duplicate member (the survivor
-- already belongs to that project).
DELETE FROM "projectMember" pm
USING (
  SELECT "id" AS loser_id FROM (
    SELECT "id", row_number() OVER (PARTITION BY "organizationId", "userId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
    FROM "member"
  ) r WHERE rn > 1
) d
WHERE pm."memberId" = d.loser_id;--> statement-breakpoint
-- Remove the duplicate member rows.
DELETE FROM "member" m
USING (
  SELECT "id" AS loser_id FROM (
    SELECT "id", row_number() OVER (PARTITION BY "organizationId", "userId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
    FROM "member"
  ) r WHERE rn > 1
) d
WHERE m."id" = d.loser_id;--> statement-breakpoint
CREATE UNIQUE INDEX "member_orgId_userId_uidx" ON "member" USING btree ("organizationId","userId");