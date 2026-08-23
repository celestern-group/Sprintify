CREATE TABLE "ssoProvider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"oidcConfig" text,
	"samlConfig" text,
	"userId" text NOT NULL,
	"providerId" text NOT NULL,
	"organizationId" text,
	CONSTRAINT "ssoProvider_providerId_unique" UNIQUE("providerId")
);
--> statement-breakpoint
ALTER TABLE "ssoProvider" ADD CONSTRAINT "ssoProvider_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssoProvider" ADD CONSTRAINT "ssoProvider_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ssoProvider_organizationId_idx" ON "ssoProvider" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ssoProvider_userId_idx" ON "ssoProvider" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ssoProvider_domain_idx" ON "ssoProvider" USING btree ("domain");