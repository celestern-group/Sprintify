import "server-only";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { tryGetAiClient } from "./client";

export type EmbeddingResult = { embedding: number[]; model: string };

/**
 * Joins an entity's free-text fields into one string to embed. Order matters
 * for embedding quality (name first, most salient), blank fields are skipped.
 */
export function embeddingSource(
  ...parts: Array<string | null | undefined>
): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

/**
 * Best-effort text embedding for one organization, via whatever provider that
 * org resolves to (its own config, or the platform's — see
 * src/lib/ai/config.ts). Returns null instead of throwing when AI isn't
 * configured, no embedding model is pinned, or the call fails — callers treat
 * embeddings as an enhancement layered on a mutation, never a requirement for
 * it to succeed.
 */
export async function embedText(
  organizationId: string,
  text: string,
): Promise<EmbeddingResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const ai = await tryGetAiClient(organizationId);
    if (!ai?.models.embedding) return null;

    const response = await ai.client.embeddings.create({
      model: ai.models.embedding,
      input: trimmed,
      // The SDK defaults to "base64" when unset. Some OpenAI-compatible
      // providers/models (seen via OpenRouter) don't support that, and
      // instead of an HTTP error return 200 with an { error } envelope and no
      // `data` — so this has to be explicit, not just a caught exception.
      encoding_format: "float",
    });
    const embedding = response.data?.[0]?.embedding;
    if (!embedding) {
      Sentry.captureException(new Error("Embedding response had no data"), {
        extra: { organizationId, model: ai.models.embedding, response },
      });
      return null;
    }

    return { embedding, model: ai.models.embedding };
  } catch (error) {
    Sentry.captureException(error);
    return null;
  }
}

/**
 * Schedules embedding generation to run after the response is sent (Next's
 * `after()`), so a create/update action isn't held open for an AI provider
 * round-trip. `persist` is only invoked when embedding actually produced a
 * result — a skip (unconfigured org, empty text, provider error) just leaves
 * the row's existing embedding columns untouched.
 */
export function scheduleEmbedding(input: {
  organizationId: string;
  text: string;
  persist: (result: EmbeddingResult) => Promise<void>;
}): void {
  after(async () => {
    const result = await embedText(input.organizationId, input.text);
    if (result) await input.persist(result);
  });
}

/**
 * Batch form of `scheduleEmbedding`, for a mutation that writes many rows at
 * once (importing a whole year of holidays, say). Rows that share the same
 * text are embedded once and the vector fanned out to all of them — holiday
 * names repeat heavily, and each duplicate would otherwise cost its own
 * provider round-trip. Distinct texts run in sequence rather than in parallel:
 * this is background work, and a 400-row import must not burst the provider's
 * rate limit. Same best-effort contract as the singular form.
 */
export function scheduleEmbeddings(input: {
  organizationId: string;
  items: Array<{ id: string; text: string }>;
  persist: (result: EmbeddingResult, ids: string[]) => Promise<void>;
}): void {
  if (!input.items.length) return;

  after(async () => {
    const idsByText = new Map<string, string[]>();
    for (const item of input.items) {
      const text = item.text.trim();
      if (!text) continue;
      const existing = idsByText.get(text);
      if (existing) existing.push(item.id);
      else idsByText.set(text, [item.id]);
    }

    for (const [text, ids] of idsByText) {
      const result = await embedText(input.organizationId, text);
      if (result) await input.persist(result, ids);
    }
  });
}
