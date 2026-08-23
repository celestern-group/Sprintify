"use server";

import { DiscoveryError, discoverOIDCConfig } from "@better-auth/sso";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { member, ssoProvider, ssoProviderProfile } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/session";
import { isPublicHttpUrl } from "@/lib/url-guard";
import { isPublicHttpUrlWithDns } from "@/lib/url-guard-dns";

const ORG_MANAGE_ROLES = new Set(["owner", "admin"]);

async function requireOrgManager(organizationId: string) {
  const session = await requireAuth();

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!membership || !ORG_MANAGE_ROLES.has(membership.role)) {
    throw new Error("You must be an organization owner or admin.");
  }

  return session;
}

async function requireOrgMember(organizationId: string) {
  const session = await requireAuth();

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new Error("You aren't a member of this organization.");
  }

  return session;
}

/**
 * Asserts the provider is one this organization owns. Every write below takes
 * a client-supplied `providerId`, and `ssoProviderProfile.providerId` is unique
 * *globally* — without this, an admin of org A who knows a provider id from
 * org B (they're listed on B's public sign-in page) could write B's row while
 * authorizing against A.
 */
async function requireProviderInOrg(
  providerId: string,
  organizationId: string,
) {
  const [provider] = await db
    .select({ providerId: ssoProvider.providerId })
    .from(ssoProvider)
    .where(
      and(
        eq(ssoProvider.providerId, providerId),
        eq(ssoProvider.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!provider) {
    throw new Error("That SSO provider doesn't belong to this organization.");
  }
}

export async function getSsoProviderProfiles(organizationId: string) {
  await requireOrgMember(organizationId);

  return db
    .select()
    .from(ssoProviderProfile)
    .where(eq(ssoProviderProfile.organizationId, organizationId));
}

const createSsoProviderProfileSchema = z.object({
  providerId: z.string(),
  organizationId: z.string(),
  displayName: z.string().max(200),
  iconKey: z.string(),
});

export async function createSsoProviderProfile(input: {
  providerId: string;
  organizationId: string;
  displayName: string;
  iconKey: string;
}) {
  const parsed = createSsoProviderProfileSchema.parse(input);
  const session = await requireOrgManager(parsed.organizationId);
  await requireProviderInOrg(parsed.providerId, parsed.organizationId);

  await db.insert(ssoProviderProfile).values({
    id: crypto.randomUUID(),
    providerId: parsed.providerId,
    organizationId: parsed.organizationId,
    displayName: parsed.displayName,
    iconKey: parsed.iconKey,
  });

  await recordAudit({
    action: "ssoProvider.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "ssoProvider",
    targetId: parsed.providerId,
    metadata: { displayName: parsed.displayName, iconKey: parsed.iconKey },
  });
  revalidatePath("/manage-org/[slug]/sso", "page");
}

const updateSsoProviderProfileSchema = z.object({
  providerId: z.string(),
  organizationId: z.string(),
  displayName: z.string().max(200),
  iconKey: z.string(),
});

export async function updateSsoProviderProfile(input: {
  providerId: string;
  organizationId: string;
  displayName: string;
  iconKey: string;
}) {
  const parsed = updateSsoProviderProfileSchema.parse(input);
  const session = await requireOrgManager(parsed.organizationId);
  await requireProviderInOrg(parsed.providerId, parsed.organizationId);

  // Scoped to BOTH ids, and checked for a hit: the org gate above authorizes
  // the org the *caller* named, so the write itself has to prove the row it
  // touches is that org's.
  const updated = await db
    .update(ssoProviderProfile)
    .set({ displayName: parsed.displayName, iconKey: parsed.iconKey })
    .where(
      and(
        eq(ssoProviderProfile.providerId, parsed.providerId),
        eq(ssoProviderProfile.organizationId, parsed.organizationId),
      ),
    )
    .returning({ id: ssoProviderProfile.id });

  if (updated.length === 0) {
    throw new Error(
      "That SSO provider profile doesn't exist for this organization.",
    );
  }

  await recordAudit({
    action: "ssoProvider.updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "ssoProvider",
    targetId: parsed.providerId,
    metadata: { displayName: parsed.displayName, iconKey: parsed.iconKey },
  });
  revalidatePath("/manage-org/[slug]/sso", "page");
}

// This action makes a server-side request to a user-supplied URL, so it is
// restricted to org owners/admins and to public https origins that RESOLVE to
// public IPs by the shared SSRF guard in src/lib/url-guard-dns.ts (which
// src/lib/ai/* reuses for provider base URLs).
const isAllowedIdpUrl = isPublicHttpUrlWithDns;

export type DiscoveredOidcEndpoints = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksEndpoint: string;
  userInfoEndpoint?: string;
  tokenEndpointAuthentication?: "client_secret_basic" | "client_secret_post";
};

/**
 * Fetches and validates `{issuer}/.well-known/openid-configuration` using the
 * same helper (and therefore the same validation and error codes) the SSO
 * plugin applies at registration time — issuer match, required endpoints,
 * supported token auth methods.
 */
export async function discoverOidcEndpoints(input: {
  organizationId: string;
  issuer: string;
}): Promise<DiscoveredOidcEndpoints | { error: string }> {
  await requireOrgManager(input.organizationId);

  const issuer = input.issuer.trim();
  if (!(await isAllowedIdpUrl(issuer))) {
    return { error: "Issuer must be a public https:// URL." };
  }

  try {
    const config = await discoverOIDCConfig({
      issuer,
      // The plugin's hook is synchronous, so it gets the literal check; the
      // resolving check already ran on the issuer above, and every endpoint the
      // document yields is re-checked (with DNS) in `ssoTrustedOrigins` before
      // registration can trust it.
      isTrustedOrigin: isPublicHttpUrl,
    });
    return {
      issuer: config.issuer,
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      jwksEndpoint: config.jwksEndpoint,
      userInfoEndpoint: config.userInfoEndpoint,
      tokenEndpointAuthentication: config.tokenEndpointAuthentication,
    };
  } catch (error) {
    if (error instanceof DiscoveryError) {
      return { error: error.message };
    }
    return { error: "Unable to reach the issuer's discovery document." };
  }
}
