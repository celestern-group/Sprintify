CREATE TABLE "workItemLink" (
	"sourceWorkItemId" text NOT NULL,
	"targetWorkItemId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workItemLink_distinct_items_check" CHECK ("workItemLink"."sourceWorkItemId" <> "workItemLink"."targetWorkItemId")
);
--> statement-breakpoint
ALTER TABLE "workItemLink" ADD CONSTRAINT "workItemLink_sourceWorkItemId_workItem_id_fk" FOREIGN KEY ("sourceWorkItemId") REFERENCES "public"."workItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workItemLink" ADD CONSTRAINT "workItemLink_targetWorkItemId_workItem_id_fk" FOREIGN KEY ("targetWorkItemId") REFERENCES "public"."workItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workItemLink_source_target_uidx" ON "workItemLink" USING btree ("sourceWorkItemId","targetWorkItemId");--> statement-breakpoint
CREATE INDEX "workItemLink_targetWorkItemId_idx" ON "workItemLink" USING btree ("targetWorkItemId");