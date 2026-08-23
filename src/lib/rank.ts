// Fractional lexicographic ranking for ordered lists (the backlog, and each
// board column).
//
// Why not an integer `position`: dropping one card between two others would
// have to renumber every row after it — a write amplification the backlog can't
// afford, and a lost-update race whenever two people drag at once. A string
// rank lets any insertion touch exactly one row: `between(a, b)` returns a
// string that sorts strictly between its neighbours, and Postgres orders it
// with a plain `order by rank`.
//
// Alphabet is base-62-ish but deliberately restricted to characters whose ASCII
// order matches their alphabet order, so JS string comparison, Postgres's C
// collation and the `text` btree all agree. Postgres's default collation can
// order differently from byte order for mixed case, so the alphabet is digits +
// lowercase only — one case class, no collation surprises.

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const MIN_CHAR = ALPHABET[0];

/** The rank the very first row in an empty list gets. */
export const INITIAL_RANK = "n";

function charIndex(char: string): number {
  const index = ALPHABET.indexOf(char);
  if (index < 0) throw new Error(`Invalid rank character: ${char}`);
  return index;
}

function isValidRank(value: string): boolean {
  if (value.length === 0) return false;
  // A trailing MIN_CHAR is unstable — nothing sorts between "1" and "10" that
  // this generator can express without unbounded growth, so it never emits one.
  if (value.endsWith(MIN_CHAR)) return false;
  for (const char of value) {
    if (ALPHABET.indexOf(char) < 0) return false;
  }
  return true;
}

/**
 * A rank strictly between `before` and `after`. Either bound may be null,
 * meaning "the start / end of the list".
 *
 * Throws when the bounds are out of order or equal — that is a caller bug (two
 * neighbours read from a stale list), and silently returning a value would put
 * the row somewhere nobody asked for.
 */
export function between(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  const lower = before ?? "";
  const upper = after ?? "";

  if (lower && !isValidRank(lower)) throw new Error(`Invalid rank: ${lower}`);
  if (upper && !isValidRank(upper)) throw new Error(`Invalid rank: ${upper}`);
  if (lower && upper && lower >= upper) {
    throw new Error("Ranks are out of order; reload the list and try again.");
  }

  let result = "";
  // True while every character emitted so far equals `upper`'s. The moment one
  // is strictly smaller, `upper` stops constraining the tail entirely ("aa…"
  // is below "ab" whatever follows) — without tracking that, a bound like "01"
  // would keep re-reading an exhausted `upper` as MIN and never terminate.
  let tiedToUpper = upper.length > 0;

  for (let position = 0; ; position += 1) {
    const lowerChar = position < lower.length ? lower[position] : MIN_CHAR;
    const lowerIndex = charIndex(lowerChar);
    const upperIndex =
      tiedToUpper && position < upper.length
        ? charIndex(upper[position])
        : ALPHABET.length - 1;

    if (upperIndex === lowerIndex) {
      // Identical so far — copy the character and keep looking further right.
      result += lowerChar;
      continue;
    }

    const midIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (midIndex !== lowerIndex) return result + ALPHABET[midIndex];

    // The bounds are adjacent (e.g. "b" and "c"): no midpoint exists at this
    // position, so take the lower character and descend — the next position
    // has the whole alphabet to work with, and we are now strictly below
    // `upper`, so it no longer applies.
    result += lowerChar;
    tiedToUpper = false;
  }
}

/** The rank for a row appended after everything currently in the list. */
export function rankAfter(last: string | null | undefined): string {
  return last ? between(last, null) : INITIAL_RANK;
}

/** The rank for a row placed ahead of everything currently in the list. */
export function rankBefore(first: string | null | undefined): string {
  return first ? between(null, first) : INITIAL_RANK;
}

/**
 * Ranks for `count` rows appended in order after `last`. Used by bulk creates
 * (and the seeding paths) so one insert doesn't need `count` round trips.
 */
export function rankSequence(
  last: string | null | undefined,
  count: number,
): string[] {
  const ranks: string[] = [];
  let cursor = last ?? null;
  for (let index = 0; index < count; index += 1) {
    cursor = rankAfter(cursor);
    ranks.push(cursor);
  }
  return ranks;
}
