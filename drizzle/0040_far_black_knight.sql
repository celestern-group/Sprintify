ALTER TABLE "holiday" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "holiday" ADD COLUMN "embeddingModel" text;--> statement-breakpoint
ALTER TABLE "holiday" ADD COLUMN "embeddingUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "holidayCalendar" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "holidayCalendar" ADD COLUMN "embeddingModel" text;--> statement-breakpoint
ALTER TABLE "holidayCalendar" ADD COLUMN "embeddingUpdatedAt" timestamp;