CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "embeddingModel" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "embeddingUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "projectRole" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "projectRole" ADD COLUMN "embeddingModel" text;--> statement-breakpoint
ALTER TABLE "projectRole" ADD COLUMN "embeddingUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "embeddingModel" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "embeddingUpdatedAt" timestamp;