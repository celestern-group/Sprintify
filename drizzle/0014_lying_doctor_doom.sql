CREATE TABLE "organizationRole" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "organizationRole" ADD CONSTRAINT "organizationRole_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizationRole_organizationId_idx" ON "organizationRole" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "organizationRole_role_idx" ON "organizationRole" USING btree ("role");