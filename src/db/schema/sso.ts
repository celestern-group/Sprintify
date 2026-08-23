import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, ssoProvider } from "./auth";

/**
 * Display metadata for an org's SSO providers. The `ssoProvider` table
 * (owned by the `@better-auth/sso` plugin) has no name/icon field and its
 * config columns hold secrets, so this companion table is what the public
 * per-org sign-in page is allowed to read from directly.
 */
export const ssoProviderProfile = pgTable(
  "ssoProviderProfile",
  {
    id: text().primaryKey(),
    providerId: text()
      .notNull()
      .unique()
      .references(() => ssoProvider.providerId, { onDelete: "cascade" }),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    displayName: text().notNull(),
    iconKey: text().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    index("ssoProviderProfile_organizationId_idx").on(table.organizationId),
  ],
);

export const ssoProviderProfileRelations = relations(
  ssoProviderProfile,
  ({ one }) => ({
    provider: one(ssoProvider, {
      fields: [ssoProviderProfile.providerId],
      references: [ssoProvider.providerId],
    }),
    organization: one(organization, {
      fields: [ssoProviderProfile.organizationId],
      references: [organization.id],
    }),
  }),
);
