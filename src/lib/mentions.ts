// Reading @-mentions back out of stored markdown.
//
// A plain module, deliberately free of "server-only" and of React: the composer
// parses its own draft before posting, and the server re-parses the stored text
// before notifying. Both need the same answer, and the SERVER's is the one that
// counts — whatever a client sends is treated as a hint and re-resolved against
// the project's membership.

/**
 * A mention has no markdown syntax, so it round-trips as an inline HTML span
 * (see comment-editor.tsx). This reads the ids back out of that span.
 *
 * Attribute-order-independent on purpose: the editor writes `data-type` before
 * `data-id`, but pasted or hand-edited text need not, and a mention that
 * renders as a chip must also count as a mention.
 */
const MENTION_SPAN = /<span\b[^>]*>/gi;
const DATA_TYPE_MENTION = /\bdata-type\s*=\s*"mention"/i;
const DATA_ID = /\bdata-id\s*=\s*"([^"]*)"/i;

/**
 * The member ids a markdown body @-mentions.
 *
 * Read off the TEXT rather than tracked as the user types — an undo, a paste or
 * a deletion would leave a tracked list describing a document that no longer
 * exists. Order is preserved and duplicates collapse, so "@Ada … @Ada" pages
 * Ada once.
 */
export function mentionedMemberIdsIn(markdown: string): string[] {
  const ids = new Set<string>();
  for (const [tag] of markdown.matchAll(MENTION_SPAN)) {
    if (!DATA_TYPE_MENTION.test(tag)) continue;
    const id = tag.match(DATA_ID)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Every id mentioned across several fields, de-duplicated. */
export function mentionedMemberIdsAcross(
  bodies: (string | null | undefined)[],
): string[] {
  const ids = new Set<string>();
  for (const body of bodies) {
    if (!body) continue;
    for (const id of mentionedMemberIdsIn(body)) ids.add(id);
  }
  return [...ids];
}
