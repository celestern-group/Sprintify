import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  image: text(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text(),
  banned: boolean().default(false),
  banReason: text(),
  banExpires: timestamp(),
  twoFactorEnabled: boolean().default(false),
});

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp().notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text(),
    activeOrganizationId: text(),
    // The project whose workspace the session is currently "inside", mirroring
    // Better Auth's activeOrganizationId. Org-level pages that still render in
    // project chrome (/app/[orgSlug]/availability) read it instead of a URL
    // segment. No FK: the column belongs to Better Auth's
    // table and a deleted project is resolved away at read time
    // (src/lib/active-project.ts) rather than cascading into sessions.
    activeProjectId: text(),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp(),
    refreshTokenExpiresAt: timestamp(),
    scope: text(),
    password: text(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable(
  "organization",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    logo: text(),
    createdAt: timestamp().notNull(),
    metadata: text(),
    // Platform-admin-owned grant: may this org use the platform AI config?
    // Nullable tri-state — null follows platformAiConfig.defaultOrgAccess,
    // true/false is an explicit per-org allow/deny. Lives here (not on
    // organizationAiConfig) so an org-admin save can never touch it.
    aiPlatformAccess: boolean(),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export const member = pgTable(
  "member",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().default("member").notNull(),
    createdAt: timestamp().notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
    // A user can hold at most one membership row per organization. Guards
    // against double-accepted invitations / races producing duplicate members
    // (which would fragment project access, since projectMember.memberId
    // references member.id).
    uniqueIndex("member_orgId_userId_uidx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text(),
    status: text().default("pending").notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
    inviterId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const ssoProvider = pgTable(
  "ssoProvider",
  {
    id: text().primaryKey(),
    issuer: text().notNull(),
    domain: text().notNull(),
    domainVerified: boolean().default(false),
    oidcConfig: text(),
    samlConfig: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text().notNull().unique(),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("ssoProvider_organizationId_idx").on(table.organizationId),
    index("ssoProvider_userId_idx").on(table.userId),
    index("ssoProvider_domain_idx").on(table.domain),
  ],
);

export const apikey = pgTable(
  "apikey",
  {
    id: text().primaryKey(),
    configId: text().default("default").notNull(),
    name: text(),
    start: text(),
    referenceId: text().notNull(),
    prefix: text(),
    key: text().notNull(),
    refillInterval: integer(),
    refillAmount: integer(),
    lastRefillAt: timestamp(),
    enabled: boolean().default(true),
    rateLimitEnabled: boolean().default(true),
    rateLimitTimeWindow: integer().default(86400000),
    rateLimitMax: integer().default(10),
    requestCount: integer().default(0),
    remaining: integer(),
    lastRequest: timestamp(),
    expiresAt: timestamp(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    permissions: text(),
    metadata: text(),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

// Better Auth twoFactor plugin: TOTP secret + backup codes per user, plus the
// account-lockout counters. One row per user (created on 2FA enrollment).
export const twoFactor = pgTable(
  "twoFactor",
  {
    id: text().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean().default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: timestamp(),
  },
  (table) => [
    index("twoFactor_secret_idx").on(table.secret),
    index("twoFactor_userId_idx").on(table.userId),
  ],
);

// Better Auth persistent rate-limit store (rateLimit.storage = "database").
// `lastRequest` is epoch milliseconds.
export const rateLimit = pgTable("rateLimit", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  ssoProviders: many(ssoProvider),
  twoFactors: many(twoFactor),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  ssoProviders: many(ssoProvider),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const ssoProviderRelations = relations(ssoProvider, ({ one }) => ({
  user: one(user, {
    fields: [ssoProvider.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [ssoProvider.organizationId],
    references: [organization.id],
  }),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, {
    fields: [twoFactor.userId],
    references: [user.id],
  }),
}));
