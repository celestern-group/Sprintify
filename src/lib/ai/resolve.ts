import type { AiProvider } from "./providers";
import { resolveBaseUrl } from "./providers";

/**
 * Decides which AI configuration an organization actually gets.
 *
 * Kept as a pure function over injected rows (`selectAiConfig`) so the
 * inherit × grant × enabled × has-key matrix is unit-testable — that matrix is
 * where this feature is most likely to break. The DB-backed wrapper lives in
 * ./config.ts.
 */

export type AiConfigRow = {
  provider: AiProvider;
  baseUrl: string | null;
  apiKeyCipher: string | null;
  apiKeyHint: string | null;
  textModel: string | null;
  visionModel: string | null;
  embeddingModel: string | null;
  enabled: boolean;
};

export type PlatformAiConfigRow = AiConfigRow & {
  defaultOrgAccess: boolean;
};

export type OrganizationAiConfigRow = AiConfigRow & {
  mode: "platform" | "own";
};

export type AiUnavailableReason =
  /** Nothing has been set up in either scope. */
  | "not_configured"
  /** The org chose its own provider but hasn't finished setting it up. */
  | "org_incomplete"
  /** A platform config exists, but its master switch is off. */
  | "platform_disabled"
  /** A platform admin denied this organization the shared configuration. */
  | "platform_access_revoked"
  /** AI_ENCRYPTION_KEY changed — the stored key can no longer be read. */
  | "key_undecryptable";

export type AiConfigSelection =
  | {
      ok: true;
      source: "platform" | "organization";
      provider: AiProvider;
      baseUrl: string;
      apiKeyCipher: string;
      apiKeyHint: string | null;
      models: {
        text: string | null;
        vision: string | null;
        embedding: string | null;
      };
    }
  | { ok: false; reason: AiUnavailableReason };

/** A config is usable once it's switched on, has a key, and has a base URL. */
function usable(row: AiConfigRow | null | undefined): string | null {
  if (!row?.enabled || !row.apiKeyCipher) return null;
  return resolveBaseUrl(row.provider, row.baseUrl);
}

function present(
  source: "platform" | "organization",
  row: AiConfigRow,
  baseUrl: string,
): AiConfigSelection {
  return {
    ok: true,
    source,
    provider: row.provider,
    baseUrl,
    // biome-ignore lint/style/noNonNullAssertion: usable() proved it is set
    apiKeyCipher: row.apiKeyCipher!,
    apiKeyHint: row.apiKeyHint,
    models: {
      text: row.textModel,
      vision: row.visionModel,
      embedding: row.embeddingModel,
    },
  };
}

/**
 * Whether an org may use the platform configuration: its explicit grant if a
 * platform admin set one, otherwise the platform-wide default.
 */
export function hasPlatformAccess(
  aiPlatformAccess: boolean | null,
  defaultOrgAccess: boolean,
): boolean {
  return aiPlatformAccess ?? defaultOrgAccess;
}

export function selectAiConfig(input: {
  platform: PlatformAiConfigRow | null;
  org: OrganizationAiConfigRow | null;
  /** organization.aiPlatformAccess — null means "follow the platform default". */
  orgPlatformAccess: boolean | null;
}): AiConfigSelection {
  const { platform, org, orgPlatformAccess } = input;

  // An org that opted out of the platform config is never silently fallen back
  // to it: if their own setup is incomplete, that's the error we report, so the
  // UI can tell them what's missing instead of quietly using someone else's key.
  if (org?.mode === "own") {
    const baseUrl = usable(org);
    return baseUrl
      ? present("organization", org, baseUrl)
      : { ok: false, reason: "org_incomplete" };
  }

  if (!platform) return { ok: false, reason: "not_configured" };

  if (!hasPlatformAccess(orgPlatformAccess, platform.defaultOrgAccess)) {
    return { ok: false, reason: "platform_access_revoked" };
  }

  const baseUrl = usable(platform);
  if (!baseUrl) {
    return {
      ok: false,
      reason: platform.enabled ? "not_configured" : "platform_disabled",
    };
  }

  return present("platform", platform, baseUrl);
}

/** User-facing copy for each unavailable reason, from the org's point of view. */
export const AI_UNAVAILABLE_COPY: Record<
  AiUnavailableReason,
  { title: string; description: string }
> = {
  not_configured: {
    title: "No AI provider configured",
    description:
      "Choose a provider and add an API key to enable AI features for this organization.",
  },
  org_incomplete: {
    title: "Setup incomplete",
    description:
      "This organization uses its own provider, but it isn't switched on yet or has no API key saved.",
  },
  platform_disabled: {
    title: "Shared AI is switched off",
    description:
      "Your platform administrator has turned off the shared AI configuration. Add your own API key to continue.",
  },
  platform_access_revoked: {
    title: "Shared AI isn't available to this organization",
    description:
      "Your platform administrator hasn't granted access to the shared AI configuration. Add your own API key to continue.",
  },
  key_undecryptable: {
    title: "Stored API key can't be read",
    description:
      "The server's encryption key changed, so the saved API key can no longer be decrypted. Re-enter it to fix this.",
  },
};
