CREATE TABLE "workItemCommentReaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"commentId" text NOT NULL,
	"memberId" text NOT NULL,
	"emoji" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workItemComment" ADD COLUMN "parentId" text;--> statement-breakpoint
ALTER TABLE "workItemCommentReaction" ADD CONSTRAINT "workItemCommentReaction_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemCommentReaction" ADD CONSTRAINT "workItemCommentReaction_commentId_workItemComment_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."workItemComment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemCommentReaction" ADD CONSTRAINT "workItemCommentReaction_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workItemCommentReaction_comment_member_emoji_uidx" ON "workItemCommentReaction" USING btree ("commentId","memberId","emoji");--> statement-breakpoint
CREATE INDEX "workItemCommentReaction_commentId_idx" ON "workItemCommentReaction" USING btree ("commentId");--> statement-breakpoint
ALTER TABLE "workItemComment" ADD CONSTRAINT "workItemComment_parentId_workItemComment_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."workItemComment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workItemComment_parentId_createdAt_idx" ON "workItemComment" USING btree ("parentId","createdAt");