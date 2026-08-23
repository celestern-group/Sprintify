CREATE TABLE "platformFile" (
	"id" text PRIMARY KEY NOT NULL,
	"storageKey" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"contentType" text NOT NULL,
	"size" integer NOT NULL,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"organizationId" text,
	"uploadedByUserId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platformFile_storageKey_unique" UNIQUE("storageKey")
);
--> statement-breakpoint
ALTER TABLE "platformFile" ADD CONSTRAINT "platformFile_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platformFile" ADD CONSTRAINT "platformFile_uploadedByUserId_user_id_fk" FOREIGN KEY ("uploadedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platformFile_organizationId_idx" ON "platformFile" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "platformFile_createdAt_idx" ON "platformFile" USING btree ("createdAt");