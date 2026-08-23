/**
 * The AI rewrite operations offered on a prose field.
 *
 * A plain module, deliberately free of "server-only" and of the prompts
 * themselves: the menu is a client component and needs the labels, while what
 * each operation actually instructs the model to do stays server-side in
 * ./work-item-prompts.ts, where it can't be edited by a client.
 */

export const AI_TEXT_OPERATIONS = [
  "improve",
  "grammar",
  "structure",
  "shorten",
  "expand",
  "simplify",
  "custom",
] as const;

export type AiTextOperation = (typeof AI_TEXT_OPERATIONS)[number];

export const AI_TEXT_OPERATION_LABELS: Record<AiTextOperation, string> = {
  improve: "Improve writing",
  grammar: "Fix spelling & grammar",
  structure: "Restructure",
  shorten: "Make shorter",
  expand: "Add detail",
  simplify: "Plain language",
  custom: "Custom instruction…",
};

export const AI_TEXT_OPERATION_HINTS: Record<AiTextOperation, string> = {
  improve: "Clearer wording, same meaning.",
  grammar: "Spelling and grammar only — wording untouched.",
  structure: "Headings, bullets and short paragraphs.",
  shorten: "Cuts the padding, keeps every fact.",
  expand: "Fills in what a reader would ask next.",
  simplify: "Drops jargon so anyone can follow it.",
  custom: "Tell it what to change.",
};

/** Operations that need `instruction` filled in. */
export function needsInstruction(operation: AiTextOperation): boolean {
  return operation === "custom";
}
