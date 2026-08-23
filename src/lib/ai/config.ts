import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  organization,
  organizationAiConfig,
  platformAiConfig,
} from "@/db/schema";
import {
  decryptSecret,
  encryptSecret,
  type SecretScope,
  secretHint,
} from "@/lib/crypto";
import type { AiProvider } from "./providers";
import {
  type AiConfigSelection,
  type OrganizationAiConfigRow,
  type PlatformAiConfigRow,
  selectAiConfig,
} from "./resolve";

export const PLATFORM_AI_CONFIG_ID = "platform";

/** GCM additional-authenticated-data scope for a config row's stored key. */
export function platformScope(): SecretScope {
  return "platform";
}
export function orgScope(organizationId: string): SecretScope {
  return `org:${organizationId}`;
}

/**
 * Columns for a key write, or `{}` to leave the stored key untouched.
 *
 * Spread into BOTH legs of an upsert: on insert there is nothing to preserve,
 * and on conflict an empty object is what makes "leave blank to keep the
 * existing key" work rather than nulling it out.
 */
export function apiKeyColumns(
  apiKey: string | undefined | null,
  scope: SecretScope,
): {
  apiKeyCipher?: string;
  apiKeyHint?: string;
  apiKeyUpdatedAt?: Date;
} {
  const value = apiKey?.trim();
  if (!value) return {};
  return {
    apiKeyCipher: encryptSecret(value, scope),
    apiKeyHint: secretHint(value),
    apiKeyUpdatedAt: new Date(),
  };
}

export const CLEARED_API_KEY_COLUMNS = {
  apiKeyCipher: null,
  apiKeyHint: null,
  apiKeyUpdatedAt: null,
} as const;

/**
 * What a client is allowed to see: everything except the ciphertext. Every read
 * path selects columns explicitly — a bare `db.select()` here would ship an
 * encrypted API key into the RSC payload.
 */
export type SanitizedAiConfig = {
  provider: AiProvider;
  baseUrl: string | null;
  apiKeyHint: string | null;
  apiKeyUpdatedAt: Date | null;
  textModel: string | null;
  visionModel: string | null;
  embeddingModel: string | null;
  enabled: boolean;
};

const PLATFORM_COLUMNS = {
  provider: platformAiConfig.provider,
  baseUrl: platformAiConfig.baseUrl,
  apiKeyHint: platformAiConfig.apiKeyHint,
  apiKeyUpdatedAt: platformAiConfig.apiKeyUpdatedAt,
  textModel: platformAiConfig.textModel,
  visionModel: platformAiConfig.visionModel,
  embeddingModel: platformAiConfig.embeddingModel,
  enabled: platformAiConfig.enabled,
} as const;

const ORG_COLUMNS = {
  mode: organizationAiConfig.mode,
  provider: organizationAiConfig.provider,
  baseUrl: organizationAiConfig.baseUrl,
  apiKeyHint: organizationAiConfig.apiKeyHint,
  apiKeyUpdatedAt: organizationAiConfig.apiKeyUpdatedAt,
  textModel: organizationAiConfig.textModel,
  visionModel: organizationAiConfig.visionModel,
  embeddingModel: organizationAiConfig.embeddingModel,
  enabled: organizationAiConfig.enabled,
} as const;

export async function loadPlatformAiConfig(): Promise<
  (SanitizedAiConfig & { defaultOrgAccess: boolean }) | null
> {
  const [row] = await db
    .select({
      ...PLATFORM_COLUMNS,
      defaultOrgAccess: platformAiConfig.defaultOrgAccess,
    })
    .from(platformAiConfig)
    .where(eq(platformAiConfig.id, PLATFORM_AI_CONFIG_ID))
    .limit(1);
  return row ?? null;
}

export async function loadOrganizationAiConfig(
  organizationId: string,
): Promise<(SanitizedAiConfig & { mode: "platform" | "own" }) | null> {
  const [row] = await db
    .select(ORG_COLUMNS)
    .from(organizationAiConfig)
    .where(eq(organizationAiConfig.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/** The platform-admin grant for one org (null = follow the platform default). */
export async function loadOrganizationAiAccess(
  organizationId: string,
): Promise<boolean | null> {
  const [row] = await db
    .select({ aiPlatformAccess: organization.aiPlatformAccess })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return row?.aiPlatformAccess ?? null;
}

/**
 * The platform config's plaintext key, for actions that must call the provider
 * directly (listing models, testing the connection). Returns null when no key
 * is stored or the stored one can no longer be decrypted.
 */
export async function loadPlatformApiKey(): Promise<string | null> {
  const [row] = await db
    .select({ apiKeyCipher: platformAiConfig.apiKeyCipher })
    .from(platformAiConfig)
    .where(eq(platformAiConfig.id, PLATFORM_AI_CONFIG_ID))
    .limit(1);

  if (!row?.apiKeyCipher) return null;
  try {
    return decryptSecret(row.apiKeyCipher, platformScope());
  } catch {
    return null;
  }
}

/** As above, for one organization's own stored key. */
export async function loadOrganizationApiKey(
  organizationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ apiKeyCipher: organizationAiConfig.apiKeyCipher })
    .from(organizationAiConfig)
    .where(eq(organizationAiConfig.organizationId, organizationId))
    .limit(1);

  if (!row?.apiKeyCipher) return null;
  try {
    return decryptSecret(row.apiKeyCipher, orgScope(organizationId));
  } catch {
    return null;
  }
}

/**
 * Full resolution, including the ciphertext. Deliberately NOT wrapped in
 * React's cache() — like src/lib/platform-lockdown.ts, a revoked grant has to
 * take effect on the very next call rather than at the next request boundary.
 */
export async function resolveAiConfig(
  organizationId: string,
): Promise<AiConfigSelection> {
  const [platformRows, orgRows, accessRows] = await Promise.all([
    db
      .select()
      .from(platformAiConfig)
      .where(eq(platformAiConfig.id, PLATFORM_AI_CONFIG_ID))
      .limit(1),
    db
      .select()
      .from(organizationAiConfig)
      .where(eq(organizationAiConfig.organizationId, organizationId))
      .limit(1),
    db
      .select({ aiPlatformAccess: organization.aiPlatformAccess })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
  ]);

  return selectAiConfig({
    platform: (platformRows[0] as PlatformAiConfigRow | undefined) ?? null,
    org: (orgRows[0] as OrganizationAiConfigRow | undefined) ?? null,
    orgPlatformAccess: accessRows[0]?.aiPlatformAccess ?? null,
  });
}

/**
 * Resolution plus decryption. Fails soft on a decryption error (rotated
 * AI_ENCRYPTION_KEY, tampered row) so callers render "re-enter your API key"
 * rather than a 500.
 */
export async function resolveAiCredentials(
  organizationId: string,
): Promise<
  | (Extract<AiConfigSelection, { ok: true }> & { apiKey: string })
  | Extract<AiConfigSelection, { ok: false }>
> {
  const selection = await resolveAiConfig(organizationId);
  if (!selection.ok) return selection;

  try {
    const apiKey = decryptSecret(
      selection.apiKeyCipher,
      selection.source === "platform"
        ? platformScope()
        : orgScope(organizationId),
    );
    return { ...selection, apiKey };
  } catch {
    return { ok: false, reason: "key_undecryptable" };
  }
}
