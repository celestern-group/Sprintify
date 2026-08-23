/**
 * Reading an estimate off comparable finished work.
 *
 * Pure, so the arithmetic that produces a number someone will plan a sprint
 * around is testable without a database or a provider.
 */

/**
 * The median, not the mean: one 21-point outlier among a set of 3s should not
 * drag the suggestion, and story point scales are ordinal anyway. Rounded to a
 * half because that is the granularity the estimate field accepts.
 */
export function medianPoints(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 2) / 2;
}
