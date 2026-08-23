CREATE TABLE "wishlistRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requestedAt" timestamp DEFAULT now() NOT NULL,
	"approvedAt" timestamp,
	"approvedByUserId" text,
	"provisionedUserId" text
);
--> statement-breakpoint
ALTER TABLE "wishlistRequest" ADD CONSTRAINT "wishlistRequest_approvedByUserId_user_id_fk" FOREIGN KEY ("approvedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlistRequest" ADD CONSTRAINT "wishlistRequest_provisionedUserId_user_id_fk" FOREIGN KEY ("provisionedUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlistRequest_email_uidx" ON "wishlistRequest" USING btree ("email");--> statement-breakpoint
CREATE INDEX "wishlistRequest_status_requestedAt_idx" ON "wishlistRequest" USING btree ("status","requestedAt");