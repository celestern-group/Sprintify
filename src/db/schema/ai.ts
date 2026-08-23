import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

/**
 * AI provider configuration, in two scopes.
 *
 * Everything is expressed through the OpenAI SDK, so a provider is really just
 * a base URL + key + three pinned model ids (text / vision / embeddings).
 * `openrouter` and `openai` carry their own base URL; `compatible` takes a
 * user-supplied one (Azure, vLLM, Ollama, LiteLLM) and is therefore run through
 * the SSRF guard in src/lib/url-guard.ts on every write and every fetch.
 *
 * API keys are stored as AES-256-GCM ciphertext (src/lib/crypto.ts), scope-bound
 * so a row copied between tenants fails to decrypt. `apiKeyHint` is the only
 * form that may reach a client.
 *
 * Whether an org may *inherit* the platform config is deliberately NOT stored
 * here — it lives on `organization.aiPlatformAccess`, because it is written by
 * platform admins while this table is written by org admins. Keeping the two
 * authorities in separate tables makes it structurally impossible for an
 * org-side upsert to re-grant access a platform admin revoked.
 */

export const AI_PROVIDERS_ENUM = [
  "openrouter",
  "openai",
  "compatible",
] as const;

export const platformAiConfig = pgTable("platformAiConfig", {
  // Single row; id is always "platform" (see PLATFORM_AI_CONFIG_ID), mirroring
  // the platformSettings singleton.
  id: text().primaryKey(),
  provider: text({ enum: AI_PROVIDERS_ENUM }).default("openrouter").notNull(),
  baseUrl: text(),
  apiKeyCipher: text(),
  apiKeyHint: text(),
  apiKeyUpdatedAt: timestamp(),
  textModel: text(),
  visionModel: text(),
  embeddingModel: text(),
  // Master switch. Off means no organization resolves to the platform config,
  // regardless of individual grants.
  enabled: boolean().default(false).notNull(),
  // Whether an organization with no explicit grant (organization
  // .aiPlatformAccess is null) may use this config. Off by default: sharing a
  // platform-funded key with every tenant should be a deliberate choice.
  defaultOrgAccess: boolean().default(false).notNull(),
  updatedByUserId: text(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const organizationAiConfig = pgTable(
  "organizationAiConfig",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),
    // "platform" inherits the platform config (subject to the grant on
    // organization.aiPlatformAccess); "own" uses the columns below.
    mode: text({ enum: ["platform", "own"] })
      .default("platform")
      .notNull(),
    provider: text({ enum: AI_PROVIDERS_ENUM }).default("openrouter").notNull(),
    baseUrl: text(),
    apiKeyCipher: text(),
    apiKeyHint: text(),
    apiKeyUpdatedAt: timestamp(),
    textModel: text(),
    visionModel: text(),
    embeddingModel: text(),
    enabled: boolean().default(false).notNull(),
    updatedByUserId: text(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("organizationAiConfig_organizationId_idx").on(table.organizationId),
  ],
);

export const organizationAiConfigRelations = relations(
  organizationAiConfig,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationAiConfig.organizationId],
      references: [organization.id],
    }),
  }),
);
