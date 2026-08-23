ALTER TABLE "workItemType" DROP CONSTRAINT "workItemType_hierarchyLevel_check";--> statement-breakpoint
-- Preserve the existing hierarchy while reversing the public numeric mapping:
-- Epic 3 → 0, Feature 2 → 1, Standard 1 → 2, Sub-task 0 → 3.
UPDATE "workItemType" SET "hierarchyLevel" = 3 - "hierarchyLevel", "updatedAt" = now();--> statement-breakpoint
ALTER TABLE "workItemType" ADD CONSTRAINT "workItemType_hierarchyLevel_check" CHECK ("workItemType"."hierarchyLevel" >= 0);
