CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"leadMemberId" text,
	"source" text DEFAULT 'local' NOT NULL,
	"externalId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teamMember" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"memberId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "customMaxTeams" integer;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "maxTeams" integer;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_leadMemberId_member_id_fk" FOREIGN KEY ("leadMemberId") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_organizationId_idx" ON "team" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "team_orgId_name_uidx" ON "team" USING btree ("organizationId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "team_orgId_externalId_uidx" ON "team" USING btree ("organizationId","externalId") WHERE "team"."externalId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "teamMember_teamId_memberId_uidx" ON "teamMember" USING btree ("teamId","memberId");--> statement-breakpoint
CREATE INDEX "teamMember_teamId_idx" ON "teamMember" USING btree ("teamId");--> statement-breakpoint
CREATE INDEX "teamMember_memberId_idx" ON "teamMember" USING btree ("memberId");