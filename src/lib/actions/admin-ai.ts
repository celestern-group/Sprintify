"use server";

import { count, eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member, organization, platformAiConfig } from "@/db/schema";
import {
  apiKeyColumns,
  CLEARED_API_KEY_COLUMNS,
  loadPlatformAiConfig,
  PLATFORM_AI_CONFIG_ID,
  platformScope,
  type SanitizedAiConfig,
} from "@/lib/ai/config";
import { recordAudit } from "@/lib/audit";
import { isSecretStorageConfigured } from "@/lib/crypto";
import { requireAdminAction } from "@/lib/session";
import { assertPublicHttpUrlWithDns } from "@/lib/url-guard-dns";
import {
  savePlatformAiConfigSchema,
  setOrganizationAiAccessSchema,
} from "@/lib/validation/ai";

// A platform config change moves every inheriting org's resolved state, so the
// org page has to be invalidated alongside the admin one.
function revalidatePlatformAi() {
  revalidatePath("/admin/ai", "page");
  revalidatePath("/manage-org/[slug]/ai", "page");
}

export type PlatformAiConfigView = {
  config: (SanitizedAiConfig & { defaultOrgAccess: boolean }) | null;
  /** False when AI_ENCRYPTION_KEY is unset — the UI explains before a save fails. */
  secretStorageReady: boolean;
};

export async function getPlatformAiConfig(): Promise<PlatformAiConfigView> {
  await requireAdminAction();
  return {
    config: await loadPlatformAiConfig(),
    secretStorageReady: isSecretStorageConfigured(),
  };
}

export async function savePlatformAiConfig(input: {
  provider: "openrouter" | "openai" | "compatible";
  baseUrl?: string;
  apiKey?: string;
  textModel?: string | null;
  visionModel?: string | null;
  embeddingModel?: string | null;
  enabled: boolean;
  defaultOrgAccess: boolean;
}) {
  const parsed = savePlatformAiConfigSchema.parse(input);
  const session = await requireAdminAction();

  // The zod schema is synchronous, so it can only judge the URL as written.
  // Resolve it here too, so a public-looking hostname pointing at internal
  // infrastructure is refused at save time and not just at fetch time.
  const trimmedBaseUrl = parsed.baseUrl?.trim();
  if (trimmedBaseUrl) {
    await assertPublicHttpUrlWithDns(trimmedBaseUrl, "The provider base URL");
  }

  const keyColumns = apiKeyColumns(parsed.apiKey, platformScope());
  const values = {
    provider: parsed.provider,
    baseUrl: parsed.baseUrl?.trim() || null,
    textModel: parsed.textModel ?? null,
    visionModel: parsed.visionModel ?? null,
    embeddingModel: parsed.embeddingModel ?? null,
    enabled: parsed.enabled,
    defaultOrgAccess: parsed.defaultOrgAccess,
    updatedByUserId: session.user.id,
    // $onUpdate doesn't fire on the conflict leg, so set it by hand (same as
    // the upsert in src/lib/actions/teams.ts).
    updatedAt: new Date(),
    // Empty when no new key was supplied, which is what preserves the stored
    // one on both legs of the upsert.
    ...keyColumns,
  };

  await db
    .insert(platformAiConfig)
    .values({ id: PLATFORM_AI_CONFIG_ID, ...values })
    .onConflictDoUpdate({ target: platformAiConfig.id, set: values });

  await recordAudit({
    action: "ai.platform_config_updated",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "platform",
    targetId: PLATFORM_AI_CONFIG_ID,
    // Never the key itself — the audit log is append-only and org-visible.
    metadata: {
      provider: parsed.provider,
      enabled: parsed.enabled,
      defaultOrgAccess: parsed.defaultOrgAccess,
      textModel: parsed.textModel ?? null,
      visionModel: parsed.visionModel ?? null,
      embeddingModel: parsed.embeddingModel ?? null,
      keyChanged: Boolean(keyColumns.apiKeyHint),
      keyHint: keyColumns.apiKeyHint ?? null,
    },
  });

  if (keyColumns.apiKeyHint) {
    await recordAudit({
      action: "ai.platform_key_rotated",
      actor: { id: session.user.id, email: session.user.email },
      targetType: "platform",
      targetId: PLATFORM_AI_CONFIG_ID,
      metadata: { provider: parsed.provider, keyHint: keyColumns.apiKeyHint },
    });
  }

  revalidatePlatformAi();
}

export async function clearPlatformAiKey() {
  const session = await requireAdminAction();

  await db
    .update(platformAiConfig)
    .set({ ...CLEARED_API_KEY_COLUMNS, enabled: false, updatedAt: new Date() })
    .where(eq(platformAiConfig.id, PLATFORM_AI_CONFIG_ID));

  await recordAudit({
    action: "ai.platform_key_cleared",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "platform",
    targetId: PLATFORM_AI_CONFIG_ID,
  });

  revalidatePlatformAi();
}

export type OrganizationAiAccessRow = {
  id: string;
  name: string;
  slug: string;
  /** null = follow the platform default; true/false = explicit grant. */
  aiPlatformAccess: boolean | null;
  memberCount: number;
};

export async function listOrganizationAiAccess({
  search,
  limit,
  offset,
}: {
  search?: string;
  limit: number;
  offset: number;
}): Promise<{
  organizations: OrganizationAiAccessRow[];
  total: number;
  defaultOrgAccess: boolean;
}> {
  await requireAdminAction();

  const whereClause = search
    ? or(
        ilike(organization.name, `%${search}%`),
        ilike(organization.slug, `%${search}%`),
      )
    : undefined;

  const [rows, [{ value: total }], platform] = await Promise.all([
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        aiPlatformAccess: organization.aiPlatformAccess,
        memberCount: db.$count(
          member,
          eq(member.organizationId, organization.id),
        ),
      })
      .from(organization)
      .where(whereClause)
      .orderBy(organization.name)
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(organization).where(whereClause),
    loadPlatformAiConfig(),
  ]);

  return {
    organizations: rows,
    total,
    defaultOrgAccess: platform?.defaultOrgAccess ?? false,
  };
}

/**
 * The platform-admin grant. Writes `organization.aiPlatformAccess` — a column
 * declared `input: false` in the Better Auth org schema, so this action is the
 * only way it can change.
 */
export async function setOrganizationAiAccess(input: {
  organizationId: string;
  allowed: boolean | null;
}) {
  const parsed = setOrganizationAiAccessSchema.parse(input);
  const session = await requireAdminAction();

  const [target] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, parsed.organizationId))
    .limit(1);
  if (!target) throw new Error("Organization not found.");

  await db
    .update(organization)
    .set({ aiPlatformAccess: parsed.allowed })
    .where(eq(organization.id, parsed.organizationId));

  await recordAudit({
    action:
      parsed.allowed === false
        ? "ai.platform_access_revoked"
        : "ai.platform_access_granted",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: parsed.organizationId,
    metadata: {
      organizationName: target.name,
      // null means the org follows the platform-wide default again.
      allowed: parsed.allowed,
    },
  });

  revalidatePath("/admin/ai", "page");
  revalidatePath("/admin/organizations", "page");
  revalidatePath("/admin/organizations/[id]", "page");
  revalidatePath("/manage-org/[slug]/ai", "page");
}
