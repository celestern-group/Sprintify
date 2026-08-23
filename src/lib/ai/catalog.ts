import "server-only";
import OpenAI from "openai";
import { assertPublicHttpUrlWithDns, guardedFetch } from "@/lib/url-guard-dns";
import type { AiModelKind, AiProvider } from "./providers";
import { AI_PROVIDERS } from "./providers";

/**
 * Model catalogs, used to populate the searchable model pickers.
 *
 * OpenRouter publishes two catalog endpoints that need no API key, so an admin
 * can browse and pick models *before* saving a key. Everything else has to be
 * listed with the caller's credentials via the OpenAI SDK.
 *
 * The catalog is an autocomplete source, never a validator: a model id that
 * isn't in the list is still saveable, because a self-hosted gateway can serve
 * anything and a catalog fetch can fail.
 */

export type CatalogModel = {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per 1M prompt tokens, or null when unknown/free-form. */
  promptPricePerMillion: number | null;
  description: string | null;
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_EMBEDDINGS_URL =
  "https://openrouter.ai/api/v1/embeddings/models";
const FETCH_TIMEOUT_MS = 8000;
const CATALOG_TTL_SECONDS = 3600;

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string | null;
  context_length?: number | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  } | null;
  pricing?: { prompt?: string | null } | null;
};

function toCatalogModel(model: OpenRouterModel): CatalogModel {
  const prompt = Number.parseFloat(model.pricing?.prompt ?? "");
  return {
    id: model.id,
    name: model.name ?? model.id,
    contextLength: model.context_length ?? null,
    // OpenRouter prices per token; per-million is what people compare on.
    promptPricePerMillion: Number.isFinite(prompt) ? prompt * 1_000_000 : null,
    description: model.description?.trim() || null,
  };
}

async function fetchOpenRouter(url: string): Promise<OpenRouterModel[]> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: CATALOG_TTL_SECONDS },
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter returned ${response.status} while listing models.`,
    );
  }
  const body = (await response.json()) as { data?: OpenRouterModel[] };
  return body.data ?? [];
}

async function listOpenRouterModels(
  kind: AiModelKind,
): Promise<CatalogModel[]> {
  if (kind === "embedding") {
    const models = await fetchOpenRouter(OPENROUTER_EMBEDDINGS_URL);
    return models.map(toCatalogModel);
  }

  const models = await fetchOpenRouter(OPENROUTER_MODELS_URL);
  return models
    .filter((model) => {
      const architecture = model.architecture;
      const outputs = architecture?.output_modalities ?? ["text"];
      if (!outputs.includes("text")) return false;
      // Vision = the model accepts images alongside text.
      return kind === "vision"
        ? (architecture?.input_modalities ?? []).includes("image")
        : true;
    })
    .map(toCatalogModel);
}

// `models.list()` returns bare ids with no modality metadata, so the split is
// necessarily a heuristic. Embeddings are reliably identifiable; text and
// vision are not, so both get the full non-embedding list and the admin picks.
const EMBEDDING_ID_PATTERN = /embed/i;

async function listOpenAiCompatibleModels(input: {
  kind: AiModelKind;
  baseUrl: string;
  apiKey: string;
}): Promise<CatalogModel[]> {
  await assertPublicHttpUrlWithDns(input.baseUrl, "The provider base URL");

  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    timeout: FETCH_TIMEOUT_MS,
    maxRetries: 1,
    fetch: guardedFetch,
  });

  const page = await client.models.list();
  return page.data
    .filter((model) =>
      input.kind === "embedding"
        ? EMBEDDING_ID_PATTERN.test(model.id)
        : !EMBEDDING_ID_PATTERN.test(model.id),
    )
    .map((model) => ({
      id: model.id,
      name: model.id,
      contextLength: null,
      promptPricePerMillion: null,
      description: model.owned_by ? `Owned by ${model.owned_by}` : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export type CatalogResult =
  | { ok: true; models: CatalogModel[] }
  | { ok: false; error: string };

/**
 * Lists models for one provider and slot. Never throws: a catalog outage must
 * degrade the picker to free-text entry, not break the settings page.
 */
export async function listModels(input: {
  provider: AiProvider;
  kind: AiModelKind;
  baseUrl: string | null;
  apiKey: string | null;
}): Promise<CatalogResult> {
  try {
    if (AI_PROVIDERS[input.provider].catalog === "openrouter") {
      return { ok: true, models: await listOpenRouterModels(input.kind) };
    }

    if (!input.apiKey) {
      return {
        ok: false,
        error: "Save an API key first to load this provider's model list.",
      };
    }
    if (!input.baseUrl) {
      return { ok: false, error: "Set a base URL to load the model list." };
    }

    return {
      ok: true,
      models: await listOpenAiCompatibleModels({
        kind: input.kind,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not load the model list.",
    };
  }
}
