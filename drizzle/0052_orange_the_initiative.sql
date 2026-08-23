ALTER TABLE "workItemComment" ADD COLUMN "authorKind" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "workItemComment" ADD COLUMN "aiModel" text;