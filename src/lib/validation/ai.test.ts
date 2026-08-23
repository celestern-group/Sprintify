import { describe, expect, it } from "vitest";
import {
  saveOrganizationAiConfigSchema,
  savePlatformAiConfigSchema,
  setOrganizationAiAccessSchema,
} from "./ai";

const base = {
  provider: "openrouter" as const,
  enabled: true,
  defaultOrgAccess: false,
};

describe("savePlatformAiConfigSchema", () => {
  it("accepts a minimal OpenRouter config", () => {
    expect(savePlatformAiConfigSchema.parse(base)).toMatchObject({
      provider: "openrouter",
      enabled: true,
    });
  });

  it("normalises blank model ids to null", () => {
    const parsed = savePlatformAiConfigSchema.parse({
      ...base,
      textModel: "  ",
      visionModel: " anthropic/claude-opus-5 ",
    });
    expect(parsed.textModel).toBeNull();
    expect(parsed.visionModel).toBe("anthropic/claude-opus-5");
  });

  it("accepts an unknown model id — the catalog is autocomplete, not an allow-list", () => {
    expect(
      savePlatformAiConfigSchema.parse({
        ...base,
        textModel: "my-org/self-hosted-llama-42",
      }).textModel,
    ).toBe("my-org/self-hosted-llama-42");
  });

  it("rejects an implausibly short API key", () => {
    expect(() =>
      savePlatformAiConfigSchema.parse({ ...base, apiKey: "abc" }),
    ).toThrow();
  });

  it("treats an omitted API key as 'keep the stored one'", () => {
    expect(savePlatformAiConfigSchema.parse(base).apiKey).toBeUndefined();
  });
});

describe("base URL rules for the compatible provider", () => {
  const compatible = { ...base, provider: "compatible" as const };

  it("requires a base URL", () => {
    expect(() => savePlatformAiConfigSchema.parse(compatible)).toThrow(
      /base URL is required/,
    );
  });

  it("accepts a public https URL", () => {
    expect(
      savePlatformAiConfigSchema.parse({
        ...compatible,
        baseUrl: "https://llm.example.com/v1",
      }).baseUrl,
    ).toBe("https://llm.example.com/v1");
  });

  it("rejects a non-URL", () => {
    expect(() =>
      savePlatformAiConfigSchema.parse({ ...compatible, baseUrl: "not a url" }),
    ).toThrow(/public https/);
  });

  it("ignores a base URL for providers that pin their own endpoint", () => {
    expect(() =>
      savePlatformAiConfigSchema.parse({
        ...base,
        provider: "openai",
        baseUrl: "",
      }),
    ).not.toThrow();
  });
});

describe("saveOrganizationAiConfigSchema", () => {
  it("requires an organization id and a mode", () => {
    expect(
      saveOrganizationAiConfigSchema.parse({
        ...base,
        organizationId: "org_1",
        mode: "own",
      }),
    ).toMatchObject({ organizationId: "org_1", mode: "own" });
    expect(() =>
      saveOrganizationAiConfigSchema.parse({ ...base, mode: "own" }),
    ).toThrow();
  });

  it("has no defaultOrgAccess field — that's platform-admin territory", () => {
    const parsed = saveOrganizationAiConfigSchema.parse({
      ...base,
      organizationId: "org_1",
      mode: "platform",
      defaultOrgAccess: true,
    });
    expect(parsed).not.toHaveProperty("defaultOrgAccess");
  });
});

describe("setOrganizationAiAccessSchema", () => {
  it("accepts allow, deny, and 'follow the default'", () => {
    for (const allowed of [true, false, null]) {
      expect(
        setOrganizationAiAccessSchema.parse({ organizationId: "o", allowed })
          .allowed,
      ).toBe(allowed);
    }
  });

  it("rejects a missing allowed value", () => {
    expect(() =>
      setOrganizationAiAccessSchema.parse({ organizationId: "o" }),
    ).toThrow();
  });
});
