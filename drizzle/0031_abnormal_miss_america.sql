ALTER TABLE "plan" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "priceCents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The zero-entitlement "No plan" default is the blocked fallback, never an
-- offer in the plan-selection wizard.
UPDATE "plan" SET "enabled" = false WHERE "name" = 'No plan';