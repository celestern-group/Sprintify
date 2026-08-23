CREATE TABLE "projectMember" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"memberId" text NOT NULL,
	"role" text DEFAULT 'developer' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projectMember" ADD CONSTRAINT "projectMember_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projectMember" ADD CONSTRAINT "projectMember_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projectMember_projectId_memberId_uidx" ON "projectMember" USING btree ("projectId","memberId");--> statement-breakpoint
CREATE INDEX "projectMember_memberId_idx" ON "projectMember" USING btree ("memberId");