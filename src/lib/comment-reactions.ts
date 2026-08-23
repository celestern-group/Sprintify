// The reaction vocabulary, shared by the picker and the server actions.
//
// A CLOSED set, not free-form emoji. Two reasons: the stored column stays
// something the UI can always render (an arbitrary glyph from someone's IME
// becomes a tofu box on another machine), and a fixed vocabulary is what makes
// a reaction skimmable — eight known marks read at a glance, two hundred
// do not. This is the same rule the design system applies to status colour:
// meaning lives in a small closed set, never in free choice.
//
// Client-safe: no db or server imports, so the picker and the validator share
// exactly one definition.

export const COMMENT_REACTIONS = [
  { emoji: "👍", label: "Agree" },
  { emoji: "👎", label: "Disagree" },
  { emoji: "🎉", label: "Celebrate" },
  { emoji: "😄", label: "Funny" },
  { emoji: "😕", label: "Confused" },
  { emoji: "❤️", label: "Love" },
  { emoji: "🚀", label: "Shipped" },
  { emoji: "👀", label: "Looking" },
] as const satisfies readonly { emoji: string; label: string }[];

export type CommentReaction = (typeof COMMENT_REACTIONS)[number];
export type CommentReactionEmoji = CommentReaction["emoji"];

const BY_EMOJI = new Map(
  COMMENT_REACTIONS.map((entry) => [entry.emoji as string, entry]),
);

export function isCommentReactionEmoji(
  value: unknown,
): value is CommentReactionEmoji {
  return typeof value === "string" && BY_EMOJI.has(value);
}

/**
 * The word for an emoji, for `aria-label` and tooltips. Colour is never the
 * only signal in this system and neither is a glyph — a screen reader must get
 * "Agree, 3 people", not "thumbs up sign".
 */
export function reactionLabel(emoji: string): string {
  return BY_EMOJI.get(emoji)?.label ?? emoji;
}

/**
 * Reactions in catalog order regardless of what order they were stored in, so
 * a comment's chips don't reshuffle as people react.
 */
export function sortReactionEmojis(emojis: string[]): string[] {
  const order = COMMENT_REACTIONS.map((entry) => entry.emoji as string);
  return [...emojis].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
