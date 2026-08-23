import { describe, expect, it } from "vitest";
import {
  hasPlatformAccess,
  type OrganizationAiConfigRow,
  type PlatformAiConfigRow,
  selectAiConfig,
} from "./resolve";

const platformRow = (
  overrides: Partial<PlatformAiConfigRow> = {},
): PlatformAiConfigRow => ({
  provider: "openrouter",
  baseUrl: null,
  apiKeyCipher: "v1.a.b.c",
  apiKeyHint: "••••1234",
  textModel: "anthropic/claude-opus-5",
  visionModel: "anthropic/claude-opus-5",
  embeddingModel: "openai/text-embedding-3-small",
  enabled: true,
  defaultOrgAccess: true,
  ...overrides,
});

const orgRow = (
  overrides: Partial<OrganizationAiConfigRow> = {},
): OrganizationAiConfigRow => ({
  mode: "own",
  provider: "openai",
  baseUrl: null,
  apiKeyCipher: "v1.d.e.f",
  apiKeyHint: "••••5678",
  textModel: "gpt-4.1",
  visionModel: "gpt-4.1",
  embeddingModel: "text-embedding-3-large",
  enabled: true,
  ...overrides,
});

describe("hasPlatformAccess", () => {
  it("uses the platform default when the org has no explicit grant", () => {
    expect(hasPlatformAccess(null, true)).toBe(true);
    expect(hasPlatformAccess(null, false)).toBe(false);
  });

  it("lets an explicit per-org grant win over the default", () => {
    expect(hasPlatformAccess(true, false)).toBe(true);
    expect(hasPlatformAccess(false, true)).toBe(false);
  });
});

describe("selectAiConfig — inheriting the platform config", () => {
  it("resolves to the platform config when granted", () => {
    const result = selectAiConfig({
      platform: platformRow(),
      org: null,
      orgPlatformAccess: null,
    });
    expect(result).toMatchObject({
      ok: true,
      source: "platform",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      models: { text: "anthropic/claude-opus-5" },
    });
  });

  it("also resolves when the org row exists but is in inherit mode", () => {
    const result = selectAiConfig({
      platform: platformRow(),
      org: orgRow({ mode: "platform" }),
      orgPlatformAccess: true,
    });
    expect(result).toMatchObject({ ok: true, source: "platform" });
  });

  it("refuses when the platform admin revoked this org", () => {
    expect(
      selectAiConfig({
        platform: platformRow({ defaultOrgAccess: true }),
        org: null,
        orgPlatformAccess: false,
      }),
    ).toEqual({ ok: false, reason: "platform_access_revoked" });
  });

  it("refuses when the default is off and no explicit grant exists", () => {
    expect(
      selectAiConfig({
        platform: platformRow({ defaultOrgAccess: false }),
        org: null,
        orgPlatformAccess: null,
      }),
    ).toEqual({ ok: false, reason: "platform_access_revoked" });
  });

  it("allows an explicitly granted org even when the default is off", () => {
    expect(
      selectAiConfig({
        platform: platformRow({ defaultOrgAccess: false }),
        org: null,
        orgPlatformAccess: true,
      }),
    ).toMatchObject({ ok: true, source: "platform" });
  });

  it("reports platform_disabled when the master switch is off", () => {
    expect(
      selectAiConfig({
        platform: platformRow({ enabled: false }),
        org: null,
        orgPlatformAccess: true,
      }),
    ).toEqual({ ok: false, reason: "platform_disabled" });
  });

  it("reports not_configured when the platform config has no key", () => {
    expect(
      selectAiConfig({
        platform: platformRow({ apiKeyCipher: null }),
        org: null,
        orgPlatformAccess: true,
      }),
    ).toEqual({ ok: false, reason: "not_configured" });
  });

  it("reports not_configured when nothing exists at all", () => {
    expect(
      selectAiConfig({ platform: null, org: null, orgPlatformAccess: null }),
    ).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("selectAiConfig — the org's own provider", () => {
  it("wins over the platform config", () => {
    const result = selectAiConfig({
      platform: platformRow(),
      org: orgRow(),
      orgPlatformAccess: true,
    });
    expect(result).toMatchObject({
      ok: true,
      source: "organization",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("works even when platform access is revoked — that's the whole point", () => {
    expect(
      selectAiConfig({
        platform: platformRow(),
        org: orgRow(),
        orgPlatformAccess: false,
      }),
    ).toMatchObject({ ok: true, source: "organization" });
  });

  it("works when no platform config exists at all", () => {
    expect(
      selectAiConfig({
        platform: null,
        org: orgRow(),
        orgPlatformAccess: null,
      }),
    ).toMatchObject({ ok: true, source: "organization" });
  });

  it("never silently falls back to the platform config when incomplete", () => {
    for (const broken of [
      orgRow({ apiKeyCipher: null }),
      orgRow({ enabled: false }),
      orgRow({ provider: "compatible", baseUrl: null }),
      orgRow({ provider: "compatible", baseUrl: "   " }),
    ]) {
      expect(
        selectAiConfig({
          platform: platformRow(),
          org: broken,
          orgPlatformAccess: true,
        }),
      ).toEqual({ ok: false, reason: "org_incomplete" });
    }
  });

  it("uses the admin-supplied base URL for a compatible provider", () => {
    expect(
      selectAiConfig({
        platform: null,
        org: orgRow({
          provider: "compatible",
          baseUrl: "https://llm.example.com/v1",
        }),
        orgPlatformAccess: null,
      }),
    ).toMatchObject({ baseUrl: "https://llm.example.com/v1" });
  });

  it("ignores a stray baseUrl on a fixed-endpoint provider", () => {
    expect(
      selectAiConfig({
        platform: null,
        org: orgRow({ provider: "openai", baseUrl: "https://evil.example" }),
        orgPlatformAccess: null,
      }),
    ).toMatchObject({ baseUrl: "https://api.openai.com/v1" });
  });
});
