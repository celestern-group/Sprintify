DROP TABLE "team" CASCADE;--> statement-breakpoint
DROP TABLE "teamMember" CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" DROP COLUMN "teamId";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "activeTeamId";