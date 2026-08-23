CREATE TABLE "plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"maxProjects" integer,
	"maxMembers" integer,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "planId" text;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_single_default_uidx" ON "plan" USING btree ("isDefault") WHERE "plan"."isDefault" = true;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_planId_plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."plan"("id") ON DELETE restrict ON UPDATE no action;