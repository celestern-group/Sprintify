// Who can author a comment, shared by the mention menu, the thread renderer
// and the server actions.
//
// Client-safe: no db or server imports, so the picker that OFFERS the
// assistant and the action that DETECTS it read the same constant.

/**
 * The id the @-mention menu uses for the assistant. A sentinel, not a member
 * id: the assistant has no `member` row, and giving it one would put a
 * non-person into every membership count, every picker and every permission
 * check in the app.
 *
 * It travels in the same `mentionedMemberIds` list as real mentions, so the
 * create action must pull it out BEFORE resolving the rest against
 * projectMember — that step drops anything that isn't a project member, and
 * the assistant would be silently swallowed with it.
 */
export const AI_MENTION_ID = "sprintify-ai";

/** What the assistant is called wherever it appears as an author or a mention. */
export const AI_AUTHOR_NAME = "Sprintify AI";

export function isAiMention(ids: readonly string[]): boolean {
  return ids.includes(AI_MENTION_ID);
}

/** Mention ids with the assistant's sentinel removed — what resolves to people. */
export function withoutAiMention(ids: readonly string[]): string[] {
  return ids.filter((id) => id !== AI_MENTION_ID);
}
