DROP TABLE "organizationRole" CASCADE;--> statement-breakpoint
-- Dynamic org roles are gone: any member still holding a custom role string
-- would resolve to no permissions at all, so fall them back to `member`.
UPDATE "member" SET "role" = 'member' WHERE "role" NOT IN ('member', 'admin', 'owner');--> statement-breakpoint
-- Same for invitations not yet accepted, which would otherwise be accepted
-- into a role that no longer exists.
UPDATE "invitation" SET "role" = 'member' WHERE "status" = 'pending' AND ("role" IS NULL OR "role" NOT IN ('member', 'admin', 'owner'));
