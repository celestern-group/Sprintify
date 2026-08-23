CREATE TABLE "workItemAttachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text NOT NULL,
	"workItemId" text NOT NULL,
	"fieldKey" text,
	"storageKey" text NOT NULL,
	"fileName" text NOT NULL,
	"contentType" text NOT NULL,
	"size" integer NOT NULL,
	"description" text,
	"uploadedByMemberId" text,
	"uploadedById" text,
	"uploadedByName" text,
	"uploadedByEmail" text,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workItemAttachment_storageKey_unique" UNIQUE("storageKey")
);
--> statement-breakpoint
ALTER TABLE "workItemAttachment" ADD CONSTRAINT "workItemAttachment_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemAttachment" ADD CONSTRAINT "workItemAttachment_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemAttachment" ADD CONSTRAINT "workItemAttachment_workItemId_workItem_id_fk" FOREIGN KEY ("workItemId") REFERENCES "public"."workItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemAttachment" ADD CONSTRAINT "workItemAttachment_uploadedByMemberId_member_id_fk" FOREIGN KEY ("uploadedByMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemAttachment" ADD CONSTRAINT "workItemAttachment_uploadedById_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workItemAttachment_workItemId_createdAt_idx" ON "workItemAttachment" USING btree ("workItemId","createdAt");--> statement-breakpoint
CREATE INDEX "workItemAttachment_organizationId_createdAt_idx" ON "workItemAttachment" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "workItemAttachment_projectId_idx" ON "workItemAttachment" USING btree ("projectId");--> statement-breakpoint
--
-- Backfill the two new attachment permission keys onto the roles
-- SEED_PROJECT_ROLES now grants them (src/lib/project-permissions.ts). New
-- organizations get these from the afterCreateOrganization hook; orgs that
-- already exist would otherwise have nobody able to attach a file. Matched by
-- seed `key` and restricted to source = 'local' so an externally-synced role
-- definition is never silently widened behind the system that owns it. Custom
-- roles are left alone — granting those is an admin decision, not a
-- migration's. Same shape as 0050 (comment:create / comment:moderate).
UPDATE "projectRole"
SET "permissions" = "permissions" || '["attachment:create"]'::jsonb
WHERE "source" = 'local'
  AND "key" IN ('product_owner', 'scrum_master', 'developer')
  AND NOT ("permissions" @> '["attachment:create"]'::jsonb);--> statement-breakpoint
UPDATE "projectRole"
SET "permissions" = "permissions" || '["attachment:manage"]'::jsonb
WHERE "source" = 'local'
  AND "key" IN ('product_owner', 'scrum_master')
  AND NOT ("permissions" @> '["attachment:manage"]'::jsonb);
