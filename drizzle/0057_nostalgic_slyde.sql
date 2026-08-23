ALTER TABLE "workItemType" ADD COLUMN "strictHierarchy" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "strictWorkItemHierarchy";