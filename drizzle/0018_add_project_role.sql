CREATE TABLE "projectRole" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"externalId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projectRole_default_org_scoped_check" CHECK (not ("projectRole"."isDefault" and "projectRole"."projectId" is not null))
);
--> statement-breakpoint
ALTER TABLE "projectRole" ADD CONSTRAINT "projectRole_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projectRole" ADD CONSTRAINT "projectRole_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projectRole_organizationId_key_uidx" ON "projectRole" USING btree ("organizationId","key") WHERE "projectRole"."projectId" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "projectRole_projectId_key_uidx" ON "projectRole" USING btree ("projectId","key") WHERE "projectRole"."projectId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "projectRole_organizationId_default_uidx" ON "projectRole" USING btree ("organizationId") WHERE "projectRole"."isDefault" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "projectRole_organizationId_externalId_uidx" ON "projectRole" USING btree ("organizationId","externalId") WHERE "projectRole"."externalId" is not null;--> statement-breakpoint
CREATE INDEX "projectRole_organizationId_idx" ON "projectRole" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "projectRole_projectId_idx" ON "projectRole" USING btree ("projectId");