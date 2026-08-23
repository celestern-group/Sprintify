"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizationAiConfig } from "@/db/schema";
import { type CatalogResult, listModels } from "@/lib/ai/catalog";
import { type ConnectionTestResult, testConnection } from "@/lib/ai/client";
import {
  apiKeyColumns,
  CLEARED_API_KEY_COLUMNS,
  loadOrganizationAiAccess,
  loadOrganizationAiConfig,
  loadOrganizationApiKey,
  loadPlatformAiConfig,
  loadPlatformApiKey,
  orgScope,
  resolveAiConfig,
  type SanitizedAiConfig,
} from "@/lib/ai/config";
import type { AiModelKind, AiProvider } from "@/lib/ai/providers";
import { resolveBaseUrl } from "@/lib/ai/providers";
import { type AiConfigSelection, hasPlatformAccess } from "@/lib/ai/resolve";
import { recordAudit } from "@/lib/audit";
import { isSecretStorageConfigured } from "@/lib/crypto";
import { hasOrgPermission } from "@/lib/project-access";
import { requireAdminAction, requireAuth } from "@/lib/session";
import { assertPublicHttpUrlWithDns } from "@/lib/url-guard-dns";
import {
  listAiModelsSchema,
  organizationIdSchema,
  saveOrganizationAiConfigSchema,
  testAiConnectionSchema,
} from "@/lib/validation/ai";

function revalidateOrgAi() {
  revalidatePath("/manage-org/[slug]/ai", "page");
}

// Org-level gate for AI settings — owners/admins by default, via the aiConfig
// resource in src/lib/permissions.ts.
async function requireAiPermission(
  organizationId: string,
  action: "read" | "update",
) {
  const session = await requireAuth();
  const allowed = await hasOrgPermission(organizationId, {
    aiConfig: [action],
  });
  if (!allowed) {
    throw new Error(
      action === "read"
        ? "You don't have permission to view this organization's AI settings."
        : "You don't have permission to change this organization's AI settings.",
    );
  }
  return session;
}

export type OrganizationAiConfigView = {
  config: (SanitizedAiConfig & { mode: "platform" | "own" }) | null;
  /** What inheriting would give them — never includes the platform's key. */
  platform: {
    provider: AiProvider;
    textModel: string | null;
    visionModel: string | null;
    embeddingModel: string | null;
    enabled: boolean;
  } | null;
  /** Whether the platform admin allows this org to inherit. */
  platformAccessAllowed: boolean;
  effective: AiConfigSelection;
  secretStorageReady: boolean;
};

export async function getOrganizationAiConfig(
  organizationId: string,
): Promise<OrganizationAiConfigView> {
  const parsed = organizationIdSchema.parse({ organizationId });
  await requireAiPermission(parsed.organizationId, "read");

  const [config, platform, access, effective] = await Promise.all([
    loadOrganizationAiConfig(parsed.organizationId),
    loadPlatformAiConfig(),
    loadOrganizationAiAccess(parsed.organizationId),
    resolveAiConfig(parsed.organizationId),
  ]);

  return {
    config,
    platform: platform
      ? {
          provider: platform.provider,
          textModel: platform.textModel,
          visionModel: platform.visionModel,
          embeddingModel: platform.embeddingModel,
          enabled: platform.enabled,
        }
      : null,
    platformAccessAllowed: hasPlatformAccess(
      access,
      platform?.defaultOrgAccess ?? false,
    ),
    effective,
    secretStorageReady: isSecretStorageConfigured(),
  };
}

export async function saveOrganizationAiConfig(input: {
  organizationId: string;
  mode: "platform" | "own";
  provider: AiProvider;
  baseUrl?: string;
  apiKey?: string;
  textModel?: string | null;
  visionModel?: string | null;
  embeddingModel?: string | null;
  enabled: boolean;
}) {
  const parsed = saveOrganizationAiConfigSchema.parse(input);
  const session = await requireAiPermission(parsed.organizationId, "update");

  // The zod schema is synchronous, so it can only judge the URL as written.
  // Resolve it here too, so a public-looking hostname pointing at internal
  // infrastructure is refused at save time and not just at fetch time.
  const trimmedBaseUrl = parsed.baseUrl?.trim();
  if (trimmedBaseUrl) {
    await assertPublicHttpUrlWithDns(trimmedBaseUrl, "The provider base URL");
  }

  const keyColumns = apiKeyColumns(
    parsed.apiKey,
    orgScope(parsed.organizationId),
  );

  // Only columns an org admin owns. organization.aiPlatformAccess is in a
  // different table entirely, so a save here cannot re-grant access a platform
  // admin revoked.
  const values = {
    mode: parsed.mode,
    provider: parsed.provider,
    baseUrl: parsed.baseUrl?.trim() || null,
    textModel: parsed.textModel ?? null,
    visionModel: parsed.visionModel ?? null,
    embeddingModel: parsed.embeddingModel ?? null,
    enabled: parsed.enabled,
    updatedByUserId: session.user.id,
    updatedAt: new Date(),
    ...keyColumns,
  };

  await db
    .insert(organizationAiConfig)
    .values({ organizationId: parsed.organizationId, ...values })
    .onConflictDoUpdate({
      target: organizationAiConfig.organizationId,
      set: values,
    });

  await recordAudit({
    action: "ai.org_config_updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: parsed.organizationId,
    metadata: {
      mode: parsed.mode,
      provider: parsed.provider,
      enabled: parsed.enabled,
      textModel: parsed.textModel ?? null,
      visionModel: parsed.visionModel ?? null,
      embeddingModel: parsed.embeddingModel ?? null,
      keyChanged: Boolean(keyColumns.apiKeyHint),
      keyHint: keyColumns.apiKeyHint ?? null,
    },
  });

  if (keyColumns.apiKeyHint) {
    await recordAudit({
      action: "ai.org_key_rotated",
      organizationId: parsed.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "organization",
      targetId: parsed.organizationId,
      metadata: { provider: parsed.provider, keyHint: keyColumns.apiKeyHint },
    });
  }

  revalidateOrgAi();
}

export async function clearOrganizationAiKey(input: {
  organizationId: string;
}) {
  const parsed = organizationIdSchema.parse(input);
  const session = await requireAiPermission(parsed.organizationId, "update");

  await db
    .update(organizationAiConfig)
    .set({ ...CLEARED_API_KEY_COLUMNS, enabled: false, updatedAt: new Date() })
    .where(eq(organizationAiConfig.organizationId, parsed.organizationId));

  await recordAudit({
    action: "ai.org_key_cleared",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: parsed.organizationId,
  });

  revalidateOrgAi();
}

// Shared by both settings surfaces, so the gate branches on scope the way
// src/lib/actions/audit.ts does.
async function requireScope(
  scope: "platform" | "organization",
  organizationId: string | undefined,
  action: "read" | "update",
) {
  if (scope === "platform") return requireAdminAction();
  if (!organizationId) throw new Error("An organization is required.");
  return requireAiPermission(organizationId, action);
}

/**
 * Populates the model pickers. OpenRouter's catalogs are public, so this works
 * before any key is saved; other providers need the stored key.
 */
export async function listAiModels(input: {
  scope: "platform" | "organization";
  organizationId?: string;
  provider: AiProvider;
  kind: AiModelKind;
  baseUrl?: string;
}): Promise<CatalogResult> {
  const parsed = listAiModelsSchema.parse(input);
  await requireScope(parsed.scope, parsed.organizationId, "read");

  const apiKey =
    parsed.scope === "platform"
      ? await loadPlatformApiKey()
      : // biome-ignore lint/style/noNonNullAssertion: requireScope proved it is set
        await loadOrganizationApiKey(parsed.organizationId!);

  return listModels({
    provider: parsed.provider,
    kind: parsed.kind,
    // The unsaved base URL from the form; the catalog SSRF-guards it before use.
    baseUrl: resolveBaseUrl(parsed.provider, parsed.baseUrl ?? null),
    apiKey,
  });
}

/**
 * Verifies the current form values against the provider. A newly entered key
 * is used only for this request; the result (never the key) is audited.
 */
export async function testAiConnection(input: {
  scope: "platform" | "organization";
  organizationId?: string;
  provider: AiProvider;
  baseUrl?: string;
  apiKey?: string;
  textModel?: string | null;
  embeddingModel?: string | null;
}): Promise<ConnectionTestResult> {
  const parsed = testAiConnectionSchema.parse(input);
  const session = await requireScope(
    parsed.scope,
    parsed.organizationId,
    "update",
  );

  const apiKey =
    parsed.apiKey ??
    (parsed.scope === "platform"
      ? await loadPlatformApiKey()
      : // biome-ignore lint/style/noNonNullAssertion: requireScope proved it is set
        await loadOrganizationApiKey(parsed.organizationId!));
  const baseUrl = resolveBaseUrl(parsed.provider, parsed.baseUrl ?? null);
  const models = {
    text: parsed.textModel,
    embedding: parsed.embeddingModel,
  };

  if (!apiKey) {
    return {
      ok: false,
      error:
        "No usable API key found. Enter one above — or re-enter it if the server's encryption key changed.",
    };
  }
  if (!baseUrl) {
    return { ok: false, error: "No base URL is configured for this provider." };
  }
  await assertPublicHttpUrlWithDns(baseUrl, "The provider base URL");

  const result = await testConnection({ apiKey, baseUrl, models });

  await recordAudit({
    action: "ai.connection_tested",
    organizationId:
      parsed.scope === "organization" ? parsed.organizationId : null,
    actor: { id: session.user.id, email: session.user.email },
    targetType: parsed.scope === "platform" ? "platform" : "organization",
    targetId: parsed.scope === "platform" ? "platform" : parsed.organizationId,
    metadata: {
      provider: parsed.provider,
      scope: parsed.scope,
      // The outcome only — never the key.
      success: result.ok,
      error: result.ok ? null : result.error,
    },
  });

  return result;
}
