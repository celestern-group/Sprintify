ALTER TABLE "organization" DROP CONSTRAINT "organization_planId_plan_id_fk";
--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "planId";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "customMaxProjects";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "customMaxMembers";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "customMaxOrganizations";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "customMaxTeams";--> statement-breakpoint
ALTER TABLE "plan" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "plan";
