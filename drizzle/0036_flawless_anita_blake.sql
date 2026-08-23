CREATE TABLE "holiday" (
	"id" text PRIMARY KEY NOT NULL,
	"calendarId" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidayCalendar" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"externalId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberCapacityProfile" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"memberId" text NOT NULL,
	"hoursPerDay" numeric(5, 2) DEFAULT 8 NOT NULL,
	"workingWeekdays" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"holidayCalendarId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberCapacityProfile_hoursPerDay_check" CHECK ("memberCapacityProfile"."hoursPerDay" >= 0 and "memberCapacityProfile"."hoursPerDay" <= 24)
);
--> statement-breakpoint
CREATE TABLE "memberLeave" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"memberId" text NOT NULL,
	"startDate" date NOT NULL,
	"endDate" date NOT NULL,
	"portion" numeric(3, 2) DEFAULT 1 NOT NULL,
	"type" text DEFAULT 'vacation' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"note" text,
	"createdByMemberId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberLeave_range_check" CHECK ("memberLeave"."endDate" >= "memberLeave"."startDate"),
	CONSTRAINT "memberLeave_portion_check" CHECK ("memberLeave"."portion" > 0 and "memberLeave"."portion" <= 1)
);
--> statement-breakpoint
CREATE TABLE "sprint" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"projectId" text NOT NULL,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"startDate" date NOT NULL,
	"endDate" date NOT NULL,
	"state" text DEFAULT 'planning' NOT NULL,
	"capacityUnit" text DEFAULT 'hours' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"workingWeekdays" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"plannedCapacity" numeric(10, 2) DEFAULT 0 NOT NULL,
	"committedPoints" numeric(10, 2) DEFAULT 0 NOT NULL,
	"completedPoints" numeric(10, 2) DEFAULT 0 NOT NULL,
	"startedAt" timestamp,
	"closedAt" timestamp,
	"closedByMemberId" text,
	"embedding" vector,
	"embeddingModel" text,
	"embeddingUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_range_check" CHECK ("sprint"."endDate" >= "sprint"."startDate")
);
--> statement-breakpoint
CREATE TABLE "sprintMemberCapacity" (
	"id" text PRIMARY KEY NOT NULL,
	"sprintId" text NOT NULL,
	"memberId" text NOT NULL,
	"availabilityPercent" integer DEFAULT 100 NOT NULL,
	"hoursPerDay" numeric(5, 2) DEFAULT 8 NOT NULL,
	"workingDays" numeric(5, 2) DEFAULT 0 NOT NULL,
	"holidayDays" numeric(5, 2) DEFAULT 0 NOT NULL,
	"leaveDays" numeric(5, 2) DEFAULT 0 NOT NULL,
	"plannedHours" numeric(10, 2) DEFAULT 0 NOT NULL,
	"plannedPoints" numeric(10, 2) DEFAULT 0 NOT NULL,
	"isOverridden" boolean DEFAULT false NOT NULL,
	"overrideReason" text,
	"updatedByMemberId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sprintMemberCapacity_availability_check" CHECK ("sprintMemberCapacity"."availabilityPercent" >= 0 and "sprintMemberCapacity"."availabilityPercent" <= 100),
	CONSTRAINT "sprintMemberCapacity_hoursPerDay_check" CHECK ("sprintMemberCapacity"."hoursPerDay" >= 0 and "sprintMemberCapacity"."hoursPerDay" <= 24)
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "capacityUnit" text DEFAULT 'hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "sprintLengthDays" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "defaultHoursPerDay" numeric(5, 2) DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "workingWeekdays" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "holidayCalendarId" text;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_calendarId_holidayCalendar_id_fk" FOREIGN KEY ("calendarId") REFERENCES "public"."holidayCalendar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidayCalendar" ADD CONSTRAINT "holidayCalendar_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberCapacityProfile" ADD CONSTRAINT "memberCapacityProfile_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberCapacityProfile" ADD CONSTRAINT "memberCapacityProfile_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberCapacityProfile" ADD CONSTRAINT "memberCapacityProfile_holidayCalendarId_holidayCalendar_id_fk" FOREIGN KEY ("holidayCalendarId") REFERENCES "public"."holidayCalendar"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberLeave" ADD CONSTRAINT "memberLeave_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberLeave" ADD CONSTRAINT "memberLeave_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberLeave" ADD CONSTRAINT "memberLeave_createdByMemberId_member_id_fk" FOREIGN KEY ("createdByMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_closedByMemberId_member_id_fk" FOREIGN KEY ("closedByMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprintMemberCapacity" ADD CONSTRAINT "sprintMemberCapacity_sprintId_sprint_id_fk" FOREIGN KEY ("sprintId") REFERENCES "public"."sprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprintMemberCapacity" ADD CONSTRAINT "sprintMemberCapacity_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprintMemberCapacity" ADD CONSTRAINT "sprintMemberCapacity_updatedByMemberId_member_id_fk" FOREIGN KEY ("updatedByMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_calendarId_date_uidx" ON "holiday" USING btree ("calendarId","date");--> statement-breakpoint
CREATE INDEX "holiday_calendarId_date_idx" ON "holiday" USING btree ("calendarId","date");--> statement-breakpoint
CREATE INDEX "holidayCalendar_organizationId_idx" ON "holidayCalendar" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayCalendar_orgId_name_uidx" ON "holidayCalendar" USING btree ("organizationId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayCalendar_orgId_default_uidx" ON "holidayCalendar" USING btree ("organizationId") WHERE "holidayCalendar"."isDefault" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "holidayCalendar_orgId_externalId_uidx" ON "holidayCalendar" USING btree ("organizationId","externalId") WHERE "holidayCalendar"."externalId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "memberCapacityProfile_memberId_uidx" ON "memberCapacityProfile" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "memberCapacityProfile_organizationId_idx" ON "memberCapacityProfile" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "memberLeave_orgId_memberId_startDate_idx" ON "memberLeave" USING btree ("organizationId","memberId","startDate");--> statement-breakpoint
CREATE INDEX "memberLeave_orgId_range_idx" ON "memberLeave" USING btree ("organizationId","startDate","endDate");--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_projectId_name_uidx" ON "sprint" USING btree ("projectId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_projectId_sequence_uidx" ON "sprint" USING btree ("projectId","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_projectId_active_uidx" ON "sprint" USING btree ("projectId") WHERE "sprint"."state" = 'active';--> statement-breakpoint
CREATE INDEX "sprint_projectId_startDate_idx" ON "sprint" USING btree ("projectId","startDate");--> statement-breakpoint
CREATE INDEX "sprint_organizationId_idx" ON "sprint" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "sprintMemberCapacity_sprintId_memberId_uidx" ON "sprintMemberCapacity" USING btree ("sprintId","memberId");--> statement-breakpoint
CREATE INDEX "sprintMemberCapacity_memberId_idx" ON "sprintMemberCapacity" USING btree ("memberId");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_holidayCalendarId_holidayCalendar_id_fk" FOREIGN KEY ("holidayCalendarId") REFERENCES "public"."holidayCalendar"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_sprintLengthDays_check" CHECK ("project"."sprintLengthDays" between 1 and 90);