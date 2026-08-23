CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"recipientMemberId" text NOT NULL,
	"actorId" text,
	"actorName" text,
	"actorEmail" text,
	"action" text NOT NULL,
	"targetType" text,
	"targetId" text,
	"metadata" jsonb,
	"readAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipientMemberId_member_id_fk" FOREIGN KEY ("recipientMemberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_recipient_readAt_createdAt_idx" ON "notification" USING btree ("recipientMemberId","readAt","createdAt");--> statement-breakpoint
CREATE INDEX "notification_organizationId_createdAt_idx" ON "notification" USING btree ("organizationId","createdAt");