import "server-only";
import OpenAI from "openai";
import { assertPublicHttpUrl } from "@/lib/url-guard";
import { guardedFetch } from "@/lib/url-guard-dns";
import { resolveAiCredentials } from "./config";
import type { AiModelKind, AiProvider } from "./providers";
import { AI_UNAVAILABLE_COPY, type AiUnavailableReason } from "./resolve";

/**
 * The single seam every AI feature goes through. Features ask for a client by
 * organization and never see ciphertext, provider branching, or the inheritance
 * rules — which also means those rules can change without touching consumers.
 */

export type AiClient = {
  client: OpenAI;
  provider: AiProvider;
  source: "platform" | "organization";
  models: Record<AiModelKind, string | null>;
};

export class AiNotConfiguredError extends Error {
  readonly reason: AiUnavailableReason;

  constructor(reason: AiUnavailableReason) {
    super(AI_UNAVAILABLE_COPY[reason].description);
    this.name = "AiNotConfiguredError";
    this.reason = reason;
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

export function createOpenAiClient(input: {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
}): OpenAI {
  // Re-checked here as well as on write: a base URL saved before the guard
  // existed, or edited directly in the database, must still not be fetched.
  // This factory is synchronous, so it only gets the literal check — the
  // resolving one runs per request inside `guardedFetch`, which is also what
  // keeps a re-pointed DNS record or a redirect from reaching the private
  // network after the URL was saved.
  assertPublicHttpUrl(input.baseUrl, "The provider base URL");

  return new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    timeout: input.timeoutMs ?? REQUEST_TIMEOUT_MS,
    maxRetries: input.maxRetries ?? 2,
    fetch: guardedFetch,
  });
}

/** Throws AiNotConfiguredError when the org has no usable configuration. */
export async function getAiClient(organizationId: string): Promise<AiClient> {
  const resolved = await resolveAiCredentials(organizationId);
  if (!resolved.ok) throw new AiNotConfiguredError(resolved.reason);

  return {
    client: createOpenAiClient({
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
    }),
    provider: resolved.provider,
    source: resolved.source,
    models: {
      text: resolved.models.text,
      vision: resolved.models.vision,
      embedding: resolved.models.embedding,
    },
  };
}

/** Like getAiClient, but returns null instead of throwing when unconfigured. */
export async function tryGetAiClient(
  organizationId: string,
): Promise<AiClient | null> {
  try {
    return await getAiClient(organizationId);
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return null;
    throw error;
  }
}

export type ConnectionTestResult =
  | { ok: true; checked: AiModelKind[]; latencyMs: number }
  | { ok: false; error: string };

/**
 * Verifies credentials with the smallest possible real request against each
 * configured slot. Used by the "Test connection" button, and never persists
 * anything.
 */
export async function testConnection(input: {
  apiKey: string;
  baseUrl: string;
  models: Partial<Record<AiModelKind, string | null>>;
}): Promise<ConnectionTestResult> {
  const startedAt = Date.now();
  try {
    const client = createOpenAiClient({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      // A settings probe must fail fast with immediate feedback — 0 retries and
      // a short timeout. Normal feature requests retain default retries for resilience.
      timeoutMs: 12_000,
      maxRetries: 0,
    });
    const checked: AiModelKind[] = [];

    if (input.models.text) {
      const response = await client.chat.completions.create({
        model: input.models.text,
        messages: [
          {
            role: "user",
            content: "Reply with exactly: OK",
          },
        ],
        max_tokens: 32,
      });
      const choice = response.choices?.[0];
      if (!choice?.message?.content?.trim()) {
        const finishReason = choice?.finish_reason
          ? ` (finish reason: ${choice.finish_reason})`
          : "";
        throw new Error(
          `The text model returned an empty response${finishReason}. Choose a standard chat model that returns text content.`,
        );
      }
      checked.push("text");
    }

    if (input.models.embedding) {
      const response = await client.embeddings.create({
        model: input.models.embedding,
        input: "ping",
        // See src/lib/ai/embeddings.ts — some providers 200 with an error
        // envelope instead of throwing when they reject the SDK's default
        // base64 encoding_format, which a bare create() call wouldn't catch.
        encoding_format: "float",
      });
      if (!response.data?.[0]?.embedding) {
        throw new Error("Embedding model returned no data.");
      }
      checked.push("embedding");
    }

    // No models pinned yet — listing still proves the key and URL are good.
    if (checked.length === 0) await client.models.list();

    return { ok: true, checked, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "The connection test failed.",
    };
  }
}
