CREATE TABLE "auditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text,
	"actorId" text,
	"actorEmail" text,
	"action" text NOT NULL,
	"targetType" text,
	"targetId" text,
	"metadata" jsonb,
	"ipAddress" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auditLog" ADD CONSTRAINT "auditLog_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditLog" ADD CONSTRAINT "auditLog_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditLog_organizationId_createdAt_idx" ON "auditLog" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "auditLog_actorId_createdAt_idx" ON "auditLog" USING btree ("actorId","createdAt");