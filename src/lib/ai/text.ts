import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { z } from "zod";
import { getAiClient } from "./client";
import { extractJson } from "./json";

/**
 * Text generation, the counterpart to ./embeddings.ts.
 *
 * Same seam as everything else in this folder: a feature names an organization
 * and a prompt, and never learns which provider answered. Unlike embeddings
 * this is NOT best-effort — a rewrite the user asked for and is waiting on has
 * to report why it failed, so the errors here are thrown, not swallowed.
 */

export class AiTextUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTextUnavailableError";
  }
}

const DEFAULT_MAX_TOKENS = 1500;

type ChatMessage = { role: "system" | "user"; content: string };

/**
 * OpenAI-compatible providers are a spectrum, not a standard: reasoning models
 * reject a non-default `temperature`, and plenty of self-hosted gateways 400 on
 * `response_format`. Both are quality knobs rather than requirements, so a
 * rejection retries once with them stripped instead of failing the user's
 * request.
 */
async function complete(input: {
  organizationId: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  json: boolean;
}): Promise<string> {
  const ai = await getAiClient(input.organizationId);
  if (!ai.models.text) {
    throw new AiTextUnavailableError(
      "No text model is pinned for this organization. Choose one in AI settings.",
    );
  }
  const model = ai.models.text;

  const base = {
    model,
    messages: input.messages,
    max_tokens: input.maxTokens,
  };

  const call = (extras: Record<string, unknown>) =>
    ai.client.chat.completions.create({ ...base, ...extras });

  let response: Awaited<ReturnType<typeof call>>;
  try {
    response = await call({
      temperature: input.temperature,
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: { organizationId: input.organizationId, model, phase: "tuned" },
    });
    try {
      response = await call({});
    } catch (fallbackError) {
      // A configured provider can still refuse a request (bad credentials,
      // rate limiting, timeout, or an unavailable gateway). Server actions
      // must return this as an expected AI failure: letting the SDK error
      // escape becomes Next's opaque production RSC digest in the UI.
      Sentry.captureException(fallbackError, {
        extra: {
          organizationId: input.organizationId,
          model,
          phase: "fallback",
        },
      });
      throw new AiTextUnavailableError(
        "The AI provider couldn't complete that request. Try again shortly, or check the AI connection settings.",
      );
    }
  }

  const text = response.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new AiTextUnavailableError(
      "The model returned an empty response. Try again, or try a different model.",
    );
  }
  return text;
}

/** One prose completion. Returns the model's text verbatim, trimmed. */
export async function generateText(input: {
  organizationId: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return complete({
    organizationId: input.organizationId,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.prompt },
    ],
    maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: input.temperature ?? 0.3,
    json: false,
  });
}

/**
 * A completion parsed and validated against a zod schema. The schema is the
 * contract: a model that answers with the wrong shape fails here rather than
 * halfway through rendering. Ask for an OBJECT at the top level — JSON mode is
 * specified in terms of objects, and a bare array is what providers most often
 * refuse.
 */
export async function generateObject<T>(input: {
  organizationId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const raw = await complete({
    organizationId: input.organizationId,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.prompt },
    ],
    maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: input.temperature ?? 0.2,
    json: true,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (error) {
    Sentry.captureException(error, { extra: { raw: raw.slice(0, 2000) } });
    throw new AiTextUnavailableError(
      "The model's answer wasn't valid JSON. Try again, or try a different model.",
    );
  }

  const result = input.schema.safeParse(parsed);
  if (!result.success) {
    Sentry.captureException(new Error("AI response failed schema validation"), {
      extra: { raw: raw.slice(0, 2000), issues: result.error.issues },
    });
    throw new AiTextUnavailableError(
      "The model's answer didn't match the expected shape. Try again.",
    );
  }
  return result.data;
}
