CREATE TABLE "ideaCommentReaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"commentId" text NOT NULL,
	"memberId" text NOT NULL,
	"emoji" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ideaCommentReaction" ADD CONSTRAINT "ideaCommentReaction_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaCommentReaction" ADD CONSTRAINT "ideaCommentReaction_commentId_ideaComment_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."ideaComment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideaCommentReaction" ADD CONSTRAINT "ideaCommentReaction_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ideaCommentReaction_comment_member_emoji_uidx" ON "ideaCommentReaction" USING btree ("commentId","memberId","emoji");--> statement-breakpoint
CREATE INDEX "ideaCommentReaction_commentId_idx" ON "ideaCommentReaction" USING btree ("commentId");