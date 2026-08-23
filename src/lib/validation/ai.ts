import { z } from "zod";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import { isPublicHttpUrl } from "@/lib/url-guard";

/**
 * Schemas for the AI configuration actions. They live outside the "use server"
 * file (which may only export async functions) so the cross-field rules — the
 * part most likely to be wrong — are unit-testable.
 */

export const aiProviderSchema = z.enum(["openrouter", "openai", "compatible"]);
export const aiModelKindSchema = z.enum(["text", "vision", "embedding"]);

/**
 * Model ids are free text on purpose: the catalog is an autocomplete source,
 * not an allow-list. A self-hosted gateway can serve any id, and a save must
 * never fail because a catalog fetch did.
 */
const modelIdSchema = z
  .string()
  .trim()
  .max(200, "Model id is too long.")
  .transform((value) => value || null)
  .nullable()
  .optional();

const apiKeySchema = z
  .string()
  .trim()
  .min(8, "That API key looks too short.")
  .max(500, "That API key looks too long.");

const baseConfigShape = {
  provider: aiProviderSchema,
  baseUrl: z.string().trim().max(500).optional(),
  /** Omitted or blank means "keep the key that's already stored". */
  apiKey: apiKeySchema.optional(),
  textModel: modelIdSchema,
  visionModel: modelIdSchema,
  embeddingModel: modelIdSchema,
  enabled: z.boolean(),
};

/**
 * `compatible` points the server at an admin-supplied host, so the URL is both
 * required and restricted to public origins — without this, saving a config is
 * a server-side request forgery primitive (see src/lib/url-guard.ts).
 */
function checkBaseUrl(
  value: { provider: z.infer<typeof aiProviderSchema>; baseUrl?: string },
  ctx: z.RefinementCtx,
) {
  if (!AI_PROVIDERS[value.provider].requiresBaseUrl) return;

  const baseUrl = value.baseUrl?.trim();
  if (!baseUrl) {
    ctx.addIssue({
      code: "custom",
      path: ["baseUrl"],
      message: "A base URL is required for an OpenAI-compatible provider.",
    });
    return;
  }
  if (!isPublicHttpUrl(baseUrl)) {
    ctx.addIssue({
      code: "custom",
      path: ["baseUrl"],
      message:
        "The base URL must be a public https:// address. Private, loopback, and link-local hosts aren't allowed.",
    });
  }
}

export const savePlatformAiConfigSchema = z
  .object({ ...baseConfigShape, defaultOrgAccess: z.boolean() })
  .superRefine(checkBaseUrl);

export const saveOrganizationAiConfigSchema = z
  .object({
    ...baseConfigShape,
    organizationId: z.string().min(1),
    mode: z.enum(["platform", "own"]),
  })
  .superRefine(checkBaseUrl);

export const setOrganizationAiAccessSchema = z.object({
  organizationId: z.string().min(1),
  /** null clears the explicit grant and falls back to the platform default. */
  allowed: z.boolean().nullable(),
});

export const listAiModelsSchema = z.object({
  scope: z.enum(["platform", "organization"]),
  organizationId: z.string().min(1).optional(),
  provider: aiProviderSchema,
  kind: aiModelKindSchema,
  baseUrl: z.string().trim().max(500).optional(),
  search: z.string().trim().max(200).optional(),
});

export const testAiConnectionSchema = z
  .object({
    scope: z.enum(["platform", "organization"]),
    organizationId: z.string().min(1).optional(),
    provider: aiProviderSchema,
    baseUrl: z.string().trim().max(500).optional(),
    /** Used only for this request when testing an unsaved configuration. */
    apiKey: apiKeySchema.optional(),
    textModel: modelIdSchema,
    embeddingModel: modelIdSchema,
  })
  .superRefine(checkBaseUrl);

export const organizationIdSchema = z.object({
  organizationId: z.string().min(1),
});

export type SavePlatformAiConfigInput = z.input<
  typeof savePlatformAiConfigSchema
>;
export type SaveOrganizationAiConfigInput = z.input<
  typeof saveOrganizationAiConfigSchema
>;
