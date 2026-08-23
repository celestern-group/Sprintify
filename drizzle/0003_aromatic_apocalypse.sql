ALTER TABLE "organization" ADD COLUMN "plan" text DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "plan";