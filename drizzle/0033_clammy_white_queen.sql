CREATE TABLE "organizationAiConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"mode" text DEFAULT 'platform' NOT NULL,
	"provider" text DEFAULT 'openrouter' NOT NULL,
	"baseUrl" text,
	"apiKeyCipher" text,
	"apiKeyHint" text,
	"apiKeyUpdatedAt" timestamp,
	"textModel" text,
	"visionModel" text,
	"embeddingModel" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updatedByUserId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizationAiConfig_organizationId_unique" UNIQUE("organizationId")
);
--> statement-breakpoint
CREATE TABLE "platformAiConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'openrouter' NOT NULL,
	"baseUrl" text,
	"apiKeyCipher" text,
	"apiKeyHint" text,
	"apiKeyUpdatedAt" timestamp,
	"textModel" text,
	"visionModel" text,
	"embeddingModel" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"defaultOrgAccess" boolean DEFAULT false NOT NULL,
	"updatedByUserId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "aiPlatformAccess" boolean;--> statement-breakpoint
ALTER TABLE "organizationAiConfig" ADD CONSTRAINT "organizationAiConfig_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizationAiConfig_organizationId_idx" ON "organizationAiConfig" USING btree ("organizationId");