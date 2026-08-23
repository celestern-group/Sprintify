/**
 * Recovering JSON from a model's reply.
 *
 * Kept pure and out of ./text.ts (which is server-only) because this is the
 * fragile part: providers that ignore `response_format` fence their JSON, and
 * chatty models put a sentence in front of it. Both are recoverable, and both
 * are worth a test rather than a shrug at runtime.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Anchored to the whole reply on purpose: a fence is only a WRAPPER when the
  // reply starts with one. Matching anywhere would tear apart a legitimate
  // ```code fence``` inside a string value — which is exactly what a generated
  // "technical notes" field contains.
  const fenced = trimmed.startsWith("```")
    ? trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
    : null;
  const body = (fenced?.[1] ?? trimmed).trim();
  // From the first bracket to the last closing one: anything outside that is
  // commentary, never part of the value.
  const start = body.search(/[[{]/);
  if (start === -1) return body;
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return end > start ? body.slice(start, end + 1) : body.slice(start);
}
