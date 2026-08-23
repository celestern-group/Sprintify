CREATE TABLE "workItemComment" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text NOT NULL,
	"workItemId" text NOT NULL,
	"authorMemberId" text,
	"authorId" text,
	"authorName" text,
	"authorEmail" text,
	"body" text NOT NULL,
	"mentionedMemberIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editedAt" timestamp,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workItemComment" ADD CONSTRAINT "workItemComment_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemComment" ADD CONSTRAINT "workItemComment_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemComment" ADD CONSTRAINT "workItemComment_workItemId_workItem_id_fk" FOREIGN KEY ("workItemId") REFERENCES "public"."workItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemComment" ADD CONSTRAINT "workItemComment_authorMemberId_member_id_fk" FOREIGN KEY ("authorMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemComment" ADD CONSTRAINT "workItemComment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workItemComment_workItemId_createdAt_idx" ON "workItemComment" USING btree ("workItemId","createdAt");--> statement-breakpoint
CREATE INDEX "workItemComment_organizationId_createdAt_idx" ON "workItemComment" USING btree ("organizationId","createdAt");--> statement-breakpoint
--
-- Backfill the two new permission keys onto the roles SEED_PROJECT_ROLES now
-- grants them (src/lib/project-permissions.ts). New organizations get these
-- from the afterCreateOrganization hook; orgs that already exist would
-- otherwise have nobody able to comment. Matched by seed `key` and restricted
-- to source = 'local' so an externally-synced role definition is never
-- silently widened behind the system that owns it. Custom roles are left
-- alone — granting those is an admin decision, not a migration's.
UPDATE "projectRole"
SET "permissions" = "permissions" || '["comment:create"]'::jsonb
WHERE "source" = 'local'
  AND "key" IN ('product_owner', 'scrum_master', 'developer')
  AND NOT ("permissions" @> '["comment:create"]'::jsonb);--> statement-breakpoint
UPDATE "projectRole"
SET "permissions" = "permissions" || '["comment:moderate"]'::jsonb
WHERE "source" = 'local'
  AND "key" IN ('product_owner', 'scrum_master')
  AND NOT ("permissions" @> '["comment:moderate"]'::jsonb);