CREATE TABLE "workItem" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text NOT NULL,
	"number" integer NOT NULL,
	"typeId" text NOT NULL,
	"statusId" text NOT NULL,
	"parentId" text,
	"sprintId" text,
	"summary" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"points" numeric(10, 2),
	"assigneeMemberId" text,
	"reporterMemberId" text,
	"startDate" date,
	"dueDate" date,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rank" text NOT NULL,
	"completedAt" timestamp,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workItem_points_check" CHECK ("workItem"."points" is null or "workItem"."points" >= 0),
	CONSTRAINT "workItem_dates_check" CHECK ("workItem"."startDate" is null or "workItem"."dueDate" is null or "workItem"."dueDate" >= "workItem"."startDate"),
	CONSTRAINT "workItem_parent_self_check" CHECK ("workItem"."parentId" is distinct from "workItem"."id")
);
--> statement-breakpoint
CREATE TABLE "workItemType" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hierarchyLevel" integer DEFAULT 1 NOT NULL,
	"tone" text DEFAULT 'brand' NOT NULL,
	"icon" text DEFAULT 'IconFile' NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"source" text DEFAULT 'local' NOT NULL,
	"externalId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workItemType_hierarchyLevel_check" CHECK ("workItemType"."hierarchyLevel" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "workflowStatus" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'todo' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"wipLimit" integer,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflowStatus_wipLimit_check" CHECK ("workflowStatus"."wipLimit" is null or "workflowStatus"."wipLimit" > 0)
);
--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_typeId_workItemType_id_fk" FOREIGN KEY ("typeId") REFERENCES "public"."workItemType"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_statusId_workflowStatus_id_fk" FOREIGN KEY ("statusId") REFERENCES "public"."workflowStatus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_parentId_workItem_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."workItem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_sprintId_sprint_id_fk" FOREIGN KEY ("sprintId") REFERENCES "public"."sprint"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_assigneeMemberId_member_id_fk" FOREIGN KEY ("assigneeMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItem" ADD CONSTRAINT "workItem_reporterMemberId_member_id_fk" FOREIGN KEY ("reporterMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemType" ADD CONSTRAINT "workItemType_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflowStatus" ADD CONSTRAINT "workflowStatus_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflowStatus" ADD CONSTRAINT "workflowStatus_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workItem_projectId_number_uidx" ON "workItem" USING btree ("projectId","number");--> statement-breakpoint
CREATE UNIQUE INDEX "workItem_projectId_rank_uidx" ON "workItem" USING btree ("projectId","rank");--> statement-breakpoint
CREATE INDEX "workItem_projectId_rank_idx" ON "workItem" USING btree ("projectId","rank");--> statement-breakpoint
CREATE INDEX "workItem_projectId_statusId_idx" ON "workItem" USING btree ("projectId","statusId");--> statement-breakpoint
CREATE INDEX "workItem_sprintId_idx" ON "workItem" USING btree ("sprintId");--> statement-breakpoint
CREATE INDEX "workItem_parentId_idx" ON "workItem" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "workItem_assigneeMemberId_idx" ON "workItem" USING btree ("assigneeMemberId");--> statement-breakpoint
CREATE INDEX "workItem_organizationId_idx" ON "workItem" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "workItem_typeId_idx" ON "workItem" USING btree ("typeId");--> statement-breakpoint
CREATE UNIQUE INDEX "workItemType_organizationId_key_uidx" ON "workItemType" USING btree ("organizationId","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workItemType_organizationId_name_uidx" ON "workItemType" USING btree ("organizationId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "workItemType_organizationId_default_uidx" ON "workItemType" USING btree ("organizationId") WHERE "workItemType"."isDefault" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workItemType_organizationId_externalId_uidx" ON "workItemType" USING btree ("organizationId","externalId") WHERE "workItemType"."externalId" is not null;--> statement-breakpoint
CREATE INDEX "workItemType_organizationId_idx" ON "workItemType" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "workflowStatus_projectId_name_uidx" ON "workflowStatus" USING btree ("projectId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflowStatus_projectId_default_uidx" ON "workflowStatus" USING btree ("projectId") WHERE "workflowStatus"."isDefault" = true;--> statement-breakpoint
CREATE INDEX "workflowStatus_projectId_position_idx" ON "workflowStatus" USING btree ("projectId","position");--> statement-breakpoint
CREATE INDEX "workflowStatus_organizationId_idx" ON "workflowStatus" USING btree ("organizationId");