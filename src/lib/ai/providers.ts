/**
 * The provider registry. Every provider speaks the OpenAI wire protocol, so the
 * only real differences are the base URL, where the model catalog comes from,
 * and what the key looks like. Adding a provider is one entry here.
 *
 * Plain module (no "server-only"): the config form imports the labels.
 */

export type AiProvider = "openrouter" | "openai" | "compatible";
export type AiModelKind = "text" | "vision" | "embedding";

export const AI_MODEL_KINDS = ["text", "vision", "embedding"] as const;

export const MODEL_KIND_LABELS: Record<
  AiModelKind,
  { label: string; description: string }
> = {
  text: {
    label: "Text model",
    description: "Chat and completion requests.",
  },
  vision: {
    label: "Vision model",
    description: "Requests that include images.",
  },
  embedding: {
    label: "Embeddings model",
    description: "Vector embeddings for search and retrieval.",
  },
};

type ProviderDefinition = {
  label: string;
  description: string;
  /** Fixed base URL, or null when the admin supplies one. */
  baseUrl: string | null;
  requiresBaseUrl: boolean;
  keyPlaceholder: string;
  /** Where listModels() sources this provider's catalog. */
  catalog: "openrouter" | "openai";
  docsUrl: string;
};

export const AI_PROVIDERS: Record<AiProvider, ProviderDefinition> = {
  openrouter: {
    label: "OpenRouter",
    description:
      "One key for hundreds of models across providers. Model list is searchable below.",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresBaseUrl: false,
    keyPlaceholder: "sk-or-v1-…",
    catalog: "openrouter",
    docsUrl: "https://openrouter.ai/keys",
  },
  openai: {
    label: "OpenAI",
    description: "Connect directly to the OpenAI API with your own key.",
    baseUrl: "https://api.openai.com/v1",
    requiresBaseUrl: false,
    keyPlaceholder: "sk-…",
    catalog: "openai",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  compatible: {
    label: "OpenAI-compatible",
    description:
      "Any endpoint that speaks the OpenAI API — Azure OpenAI, vLLM, Ollama, LiteLLM.",
    baseUrl: null,
    requiresBaseUrl: true,
    keyPlaceholder: "Your gateway's API key",
    catalog: "openai",
    docsUrl: "",
  },
};

export const AI_PROVIDER_ORDER: AiProvider[] = [
  "openrouter",
  "openai",
  "compatible",
];

export function providerLabel(provider: AiProvider): string {
  return AI_PROVIDERS[provider]?.label ?? provider;
}

/**
 * The base URL a client should actually use: the provider's own, or the
 * admin-supplied one for `compatible`. Callers must still run the result
 * through the SSRF guard before fetching.
 */
export function resolveBaseUrl(
  provider: AiProvider,
  baseUrl: string | null,
): string | null {
  const definition = AI_PROVIDERS[provider];
  if (!definition) return null;
  return definition.requiresBaseUrl
    ? baseUrl?.trim() || null
    : definition.baseUrl;
}
