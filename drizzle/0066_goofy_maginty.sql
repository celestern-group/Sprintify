ALTER TABLE "ideaComment" ADD COLUMN "parentId" text;--> statement-breakpoint
ALTER TABLE "ideaComment" ADD COLUMN "mentionedMemberIds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ideaComment" ADD CONSTRAINT "ideaComment_parentId_ideaComment_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."ideaComment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideaComment_parentId_createdAt_idx" ON "ideaComment" USING btree ("parentId","createdAt");