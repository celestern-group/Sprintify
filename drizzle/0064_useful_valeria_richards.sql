CREATE TABLE "idea" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text NOT NULL,
	"authorMemberId" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideaEvaluation" (
	"id" text PRIMARY KEY NOT NULL,
	"ideaId" text NOT NULL,
	"memberId" text NOT NULL,
	"impact" integer NOT NULL,
	"effort" integer NOT NULL,
	"note" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideaWorkItem" (
	"id" text PRIMARY KEY NOT NULL,
	"ideaId" text NOT NULL,
	"workItemId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idea" ADD CONSTRAINT "idea_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea" ADD CONSTRAINT "idea_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea" ADD CONSTRAINT "idea_authorMemberId_member_id_fk" FOREIGN KEY ("authorMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaEvaluation" ADD CONSTRAINT "ideaEvaluation_ideaId_idea_id_fk" FOREIGN KEY ("ideaId") REFERENCES "public"."idea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaEvaluation" ADD CONSTRAINT "ideaEvaluation_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaWorkItem" ADD CONSTRAINT "ideaWorkItem_ideaId_idea_id_fk" FOREIGN KEY ("ideaId") REFERENCES "public"."idea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaWorkItem" ADD CONSTRAINT "ideaWorkItem_workItemId_workItem_id_fk" FOREIGN KEY ("workItemId") REFERENCES "public"."workItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_projectId_idx" ON "idea" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "idea_organizationId_idx" ON "idea" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "ideaEvaluation_ideaId_memberId_uidx" ON "ideaEvaluation" USING btree ("ideaId","memberId");--> statement-breakpoint
CREATE INDEX "ideaEvaluation_ideaId_idx" ON "ideaEvaluation" USING btree ("ideaId");--> statement-breakpoint
CREATE UNIQUE INDEX "ideaWorkItem_ideaId_workItemId_uidx" ON "ideaWorkItem" USING btree ("ideaId","workItemId");--> statement-breakpoint
CREATE INDEX "ideaWorkItem_ideaId_idx" ON "ideaWorkItem" USING btree ("ideaId");