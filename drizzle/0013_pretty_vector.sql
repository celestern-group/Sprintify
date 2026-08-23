ALTER TABLE "organization" ADD COLUMN "customMaxProjects" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "customMaxMembers" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "customMaxOrganizations" integer;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "limitMode" text DEFAULT 'shared' NOT NULL;