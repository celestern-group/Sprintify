CREATE TABLE "ideaComment" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text NOT NULL,
	"ideaId" text NOT NULL,
	"authorMemberId" text,
	"authorId" text,
	"authorName" text,
	"authorEmail" text,
	"body" text NOT NULL,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideaReviewer" (
	"id" text PRIMARY KEY NOT NULL,
	"ideaId" text NOT NULL,
	"memberId" text NOT NULL,
	"requestedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idea" ADD COLUMN "plan" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "idea" ADD COLUMN "planUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "ideaComment" ADD CONSTRAINT "ideaComment_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaComment" ADD CONSTRAINT "ideaComment_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaComment" ADD CONSTRAINT "ideaComment_ideaId_idea_id_fk" FOREIGN KEY ("ideaId") REFERENCES "public"."idea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaComment" ADD CONSTRAINT "ideaComment_authorMemberId_member_id_fk" FOREIGN KEY ("authorMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaComment" ADD CONSTRAINT "ideaComment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaReviewer" ADD CONSTRAINT "ideaReviewer_ideaId_idea_id_fk" FOREIGN KEY ("ideaId") REFERENCES "public"."idea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaReviewer" ADD CONSTRAINT "ideaReviewer_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideaComment_ideaId_createdAt_idx" ON "ideaComment" USING btree ("ideaId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ideaReviewer_ideaId_memberId_uidx" ON "ideaReviewer" USING btree ("ideaId","memberId");--> statement-breakpoint
CREATE INDEX "ideaReviewer_ideaId_idx" ON "ideaReviewer" USING btree ("ideaId");