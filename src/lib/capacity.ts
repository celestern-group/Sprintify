// The sprint-capacity arithmetic, kept pure so it can be unit-tested and so
// both the server actions and the planning UI compute the same numbers.
//
// EVERY date here is a "YYYY-MM-DD" string, never a Date. A working day is a
// calendar day in the project's timezone, and the moment a Date enters the
// pipeline a UTC offset can shift a day across midnight — silently moving
// someone's leave, or dropping a day off the end of a sprint. Strings have no
// offset to get wrong. src/lib/date-only.ts holds the few conversions that are
// genuinely needed at the UI boundary.
//
// No db, no server imports: the capacity table renders these numbers live
// while someone drags an availability slider.

import {
  addDaysIso,
  compareIso,
  type IsoDate,
  isIsoDate,
  isoWeekday,
} from "@/lib/date-only";

export type { IsoDate };

/** A person's absence, clamped and applied by the functions below. */
export type LeaveWindow = {
  startDate: IsoDate;
  endDate: IsoDate;
  /** 1 = whole days off, 0.5 = half days across the range. */
  portion: number;
};

export type CapacityInput = {
  sprintStart: IsoDate;
  sprintEnd: IsoDate;
  /** 0 = Sunday. Days not listed are never working days. */
  workingWeekdays: number[];
  /** Non-working days from the applicable holiday calendar. */
  holidayDates: readonly string[];
  leaves: readonly LeaveWindow[];
  hoursPerDay: number;
  /** 0–100. Scales the *remaining* days after holidays and leave. */
  availabilityPercent: number;
};

export type CapacityResult = {
  /** Calendar working days in the sprint, before holidays or leave. */
  workingDays: number;
  /** Working days lost to the holiday calendar. */
  holidayDays: number;
  /** Working days lost to leave, excluding days already lost to holidays. */
  leaveDays: number;
  /** workingDays − holidayDays − leaveDays, scaled by availabilityPercent. */
  effectiveDays: number;
  plannedHours: number;
};

// Guards against a typo'd range spinning for years. A sprint is at most a
// quarter in every framework anyone actually runs.
const MAX_SPRINT_DAYS = 366;

/**
 * The calendar days from `start` to `end` inclusive that fall on a working
 * weekday. Returns them in order so callers can intersect with holidays and
 * leave without recomputing the walk.
 */
export function eachWorkingDay(
  start: IsoDate,
  end: IsoDate,
  workingWeekdays: readonly number[],
): IsoDate[] {
  if (compareIso(start, end) > 0) return [];

  const allowed = new Set(workingWeekdays);
  const days: IsoDate[] = [];

  let cursor = start;
  for (let guard = 0; guard <= MAX_SPRINT_DAYS; guard += 1) {
    if (allowed.has(isoWeekday(cursor))) days.push(cursor);
    if (cursor === end) return days;
    cursor = addDaysIso(cursor, 1);
  }

  return days;
}

/**
 * How many of `days` the holiday calendar removes. A holiday on a weekend is
 * not a loss — it was never a working day — so this intersects rather than
 * counting the calendar's own entries.
 */
export function holidayDaysIn(
  days: readonly IsoDate[],
  holidayDates: readonly string[],
): number {
  if (days.length === 0 || holidayDates.length === 0) return 0;
  const holidays = new Set(holidayDates);
  return days.reduce((total, day) => total + (holidays.has(day) ? 1 : 0), 0);
}

/**
 * How many of `days` leave removes, EXCLUDING days already lost to holidays.
 *
 * Double-counting here is the classic capacity bug: someone books vacation
 * across a public holiday, and the sprint loses the day twice. A day is
 * counted at most once no matter how many overlapping leave records cover it;
 * where they disagree on `portion`, the largest one wins, since the person is
 * at least that unavailable.
 */
export function leaveDaysIn(
  days: readonly IsoDate[],
  leaves: readonly LeaveWindow[],
  holidayDates: readonly string[] = [],
): number {
  if (days.length === 0 || leaves.length === 0) return 0;

  const holidays = new Set(holidayDates);
  const portionByDay = new Map<string, number>();

  for (const day of days) {
    if (holidays.has(day)) continue;
    for (const leave of leaves) {
      if (compareIso(day, leave.startDate) < 0) continue;
      if (compareIso(day, leave.endDate) > 0) continue;
      const portion = clamp(leave.portion, 0, 1);
      portionByDay.set(day, Math.max(portionByDay.get(day) ?? 0, portion));
    }
  }

  let total = 0;
  for (const portion of portionByDay.values()) total += portion;
  return round2(total);
}

/**
 * The whole calculation for one person on one sprint.
 *
 * Availability scales what is LEFT after holidays and leave, not the raw
 * sprint length — someone at 50% who also takes a week off is half of the
 * remaining week, not half of the sprint minus a full week.
 */
export function computeMemberCapacity(input: CapacityInput): CapacityResult {
  const days = eachWorkingDay(
    input.sprintStart,
    input.sprintEnd,
    input.workingWeekdays,
  );
  const workingDays = days.length;
  const holidayDays = holidayDaysIn(days, input.holidayDates);
  const leaveDays = leaveDaysIn(days, input.leaves, input.holidayDates);

  const availableDays = Math.max(0, workingDays - holidayDays - leaveDays);
  const factor = clamp(input.availabilityPercent, 0, 100) / 100;
  const effectiveDays = round2(availableDays * factor);
  const hoursPerDay = Math.max(0, input.hoursPerDay);

  return {
    workingDays,
    holidayDays,
    leaveDays,
    effectiveDays,
    plannedHours: round2(effectiveDays * hoursPerDay),
  };
}

/**
 * Points capacity from a baseline. In points mode a person's number is not
 * derived from hours — velocity is a team-historical figure, not an
 * arithmetic one — so the baseline is what they carried on a full sprint and
 * this only prorates it by how much of the sprint they are actually present
 * for. Returns 0 when there is no baseline to scale.
 */
export function plannedPointsFrom(
  baselinePoints: number,
  result: Pick<CapacityResult, "workingDays" | "effectiveDays">,
): number {
  if (baselinePoints <= 0 || result.workingDays <= 0) return 0;
  return round2(baselinePoints * (result.effectiveDays / result.workingDays));
}

/** Whole sprint working days — the denominator the UI shows beside each row. */
export function sprintWorkingDays(
  start: IsoDate,
  end: IsoDate,
  workingWeekdays: readonly number[],
): number {
  return eachWorkingDay(start, end, workingWeekdays).length;
}

/**
 * The end date `lengthDays` calendar days after `start`, inclusive of both —
 * a 14-day sprint starting Monday the 1st ends on Sunday the 14th. Used to
 * prefill the create dialog from the project's cadence.
 */
export function sprintEndFrom(start: IsoDate, lengthDays: number): IsoDate {
  const span = Math.max(1, Math.floor(lengthDays));
  return addDaysIso(start, span - 1);
}

/** True when the two inclusive ranges share at least one day. */
export function rangesOverlap(
  aStart: IsoDate,
  aEnd: IsoDate,
  bStart: IsoDate,
  bEnd: IsoDate,
): boolean {
  return compareIso(aStart, bEnd) <= 0 && compareIso(bStart, aEnd) <= 0;
}

export function isValidRange(start: string, end: string): boolean {
  return isIsoDate(start) && isIsoDate(end) && compareIso(start, end) <= 0;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Two decimals matches the numeric(x, 2) columns these land in, so a value
// never changes when it round-trips through the database.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
