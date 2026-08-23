CREATE TABLE "workItemField" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"fieldType" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"appliesToTypeIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isRequired" boolean DEFAULT false NOT NULL,
	"helpText" text,
	"position" integer DEFAULT 0 NOT NULL,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workItemFieldValue" (
	"id" text PRIMARY KEY NOT NULL,
	"workItemId" text NOT NULL,
	"fieldId" text NOT NULL,
	"value" jsonb,
	"textValue" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "acceptanceCriteria" text;--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "technicalNotes" text;--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "definitionOfDone" text;--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "stepsToReproduce" text;--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "expectedResult" text;--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "actualResult" text;--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "businessValue" text;--> statement-breakpoint
ALTER TABLE "workItem" ADD COLUMN "riskLevel" text;--> statement-breakpoint
ALTER TABLE "workItemType" ADD COLUMN "tracksDefect" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workItemField" ADD CONSTRAINT "workItemField_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemFieldValue" ADD CONSTRAINT "workItemFieldValue_workItemId_workItem_id_fk" FOREIGN KEY ("workItemId") REFERENCES "public"."workItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemFieldValue" ADD CONSTRAINT "workItemFieldValue_fieldId_workItemField_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."workItemField"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workItemField_organizationId_key_uidx" ON "workItemField" USING btree ("organizationId","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workItemField_organizationId_label_uidx" ON "workItemField" USING btree ("organizationId","label");--> statement-breakpoint
CREATE INDEX "workItemField_organizationId_idx" ON "workItemField" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "workItemFieldValue_workItemId_fieldId_uidx" ON "workItemFieldValue" USING btree ("workItemId","fieldId");--> statement-breakpoint
CREATE INDEX "workItemFieldValue_fieldId_idx" ON "workItemFieldValue" USING btree ("fieldId");