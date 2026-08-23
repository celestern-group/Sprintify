ALTER TABLE "sprintMemberCapacity" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "sprintMemberCapacity" ADD COLUMN "embeddingModel" text;--> statement-breakpoint
ALTER TABLE "sprintMemberCapacity" ADD COLUMN "embeddingUpdatedAt" timestamp;