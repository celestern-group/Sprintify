// Date-only ("YYYY-MM-DD") arithmetic, with no timezone anywhere in it.
//
// The whole capacity feature stores DATE columns and reasons about calendar
// days. Routing that through `Date` is where the bugs live: `new Date("2026-03-01")`
// parses as midnight UTC, so in any negative-offset timezone it formats back
// as February 28th, and a sprint quietly loses a day. These helpers do the
// arithmetic on the numbers themselves.
//
// Where a Date genuinely is required — react-day-picker, Kibo's Gantt — use
// isoToLocalDate/localDateToIso, which pin the time to local NOON so a DST
// shift of an hour in either direction can never cross a day boundary.

/** A calendar date with no time and no offset, formatted "YYYY-MM-DD". */
export type IsoDate = string;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  // Month is 1-based here; day 0 of the next month is the last of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Negative when a < b, 0 when equal, positive when a > b. Lexicographic
 * comparison is correct for zero-padded ISO dates, so no parsing is needed. */
export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day of the week, 0 = Sunday. Computed in UTC, which is safe because the
 * input carries no time — only the date components matter. */
export function isoWeekday(value: IsoDate): number {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDaysIso(value: IsoDate, days: number): IsoDate {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatUtc(shifted);
}

/** Inclusive day count: the same date twice is 1 day, not 0. */
export function daysBetweenIso(start: IsoDate, end: IsoDate): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Today in the given IANA timezone. `sv-SE` is the shortest way to get an
 * ISO-shaped date out of Intl without hand-assembling the parts.
 */
export function todayIso(timeZone = "UTC"): IsoDate {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * A local Date pinned to NOON, for libraries that demand Date objects.
 * Noon rather than midnight so neither a DST shift nor a timezone conversion
 * of a few hours can land on the previous or next day.
 */
export function isoToLocalDate(value: IsoDate): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** The inverse of isoToLocalDate: reads the LOCAL date parts, so a Date built
 * by a date picker in any timezone comes back as the day the user clicked. */
export function localDateToIso(value: Date): IsoDate {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatUtc(value: Date): IsoDate {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "3 Mar" / "3 Mar 2027" — short label for timeline axes and sprint cards.
 * The year is shown only when it differs from `relativeTo`'s year.
 *
 * The locale is pinned rather than left as `undefined`: these labels render on
 * the server and hydrate on the client, and the two runtimes resolve the system
 * locale differently (Node's ICU default vs the browser's), which produced a
 * hydration mismatch ("3 Aug 2026" server / "Aug 3, 2026" client). "en-GB"
 * gives the day-first shape this helper documents.
 */
export function formatIsoShort(value: IsoDate, relativeTo?: IsoDate): string {
  const date = isoToLocalDate(value);
  const sameYear = relativeTo
    ? relativeTo.slice(0, 4) === value.slice(0, 4)
    : false;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}
