ALTER TABLE "team" DROP CONSTRAINT "team_leadMemberId_member_id_fk";
--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "leadMemberId";