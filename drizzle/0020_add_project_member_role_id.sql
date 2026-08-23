ALTER TABLE "projectMember" ADD COLUMN "roleId" text;--> statement-breakpoint
ALTER TABLE "projectMember" ADD CONSTRAINT "projectMember_roleId_projectRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."projectRole"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projectMember_roleId_idx" ON "projectMember" USING btree ("roleId");