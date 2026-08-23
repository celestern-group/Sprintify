"use client";

import { useMemo } from "react";
import type { HolidayRow } from "@/lib/actions/holidays";
import {
  addDaysIso,
  formatIsoShort,
  type IsoDate,
  isoWeekday,
  todayIso,
} from "@/lib/date-only";
import { cn } from "@/lib/utils";

/**
 * A year of the selected calendar as twelve month grids — the shape people
 * actually check a holiday list against ("is the whole week of the 24th off?"),
 * which the flat date list can't show. Clicking a day hands it back to the
 * panel, which owns the add/remove dialog.
 *
 * Everything here works on "YYYY-MM-DD" strings via `date-only`; no `Date` is
 * constructed for arithmetic, so no timezone can shift a cell by a day.
 */

// Pinned locale + UTC: this renders on the server and hydrates on the client,
// and an unpinned formatter resolves the system locale differently in each.
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "UTC",
});

// Weeks start Monday, so weekends land together at the end of each row.
const WEEKDAYS = [
  { key: "mon", label: "M", weekday: 1 },
  { key: "tue", label: "T", weekday: 2 },
  { key: "wed", label: "W", weekday: 3 },
  { key: "thu", label: "T", weekday: 4 },
  { key: "fri", label: "F", weekday: 5 },
  { key: "sat", label: "S", weekday: 6 },
  { key: "sun", label: "S", weekday: 0 },
];

function daysInMonth(year: number, month: number): number {
  // Month is 1-based; day 0 of the next month is the last of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoFor(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Blank cells before the 1st, with Monday as column 0. */
function leadingBlanks(first: IsoDate): number {
  return (isoWeekday(first) + 6) % 7;
}

export type CalendarDaySelection = {
  date: IsoDate;
  holiday: HolidayRow | null;
};

export function CalendarYearGrid({
  year,
  holidays,
  workingWeekdays,
  timezone,
  canManage,
  onSelectDay,
}: {
  year: number;
  holidays: HolidayRow[];
  /** The active project's working week (0 = Sunday) — shades the rest. */
  workingWeekdays: number[];
  /** The calendar's own zone decides which day counts as "today". */
  timezone: string;
  canManage: boolean;
  onSelectDay: (selection: CalendarDaySelection) => void;
}) {
  const byDate = useMemo(
    () => new Map(holidays.map((row) => [row.date, row])),
    [holidays],
  );
  const working = useMemo(() => new Set(workingWeekdays), [workingWeekdays]);
  const today = todayIso(timezone);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
          const first = isoFor(year, month, 1);
          const total = daysInMonth(year, month);
          const days = Array.from({ length: total }, (_, i) =>
            isoFor(year, month, i + 1),
          );
          const marked = days.filter((date) => byDate.has(date)).length;

          return (
            <section
              key={month}
              aria-label={`${MONTH_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)))} ${year}`}
              className="rounded-lg border border-border p-3"
            >
              <header className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {MONTH_FORMATTER.format(
                    new Date(Date.UTC(year, month - 1, 1)),
                  )}
                </h3>
                {marked > 0 ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {marked} off
                  </span>
                ) : null}
              </header>

              <div className="grid grid-cols-7 gap-0.5">
                {WEEKDAYS.map((day) => (
                  <span
                    key={day.key}
                    aria-hidden
                    className={cn(
                      "pb-1 text-center text-[10px] uppercase text-muted-foreground",
                      // Weight, not a faded ink, separates the non-working
                      // columns — /60 muted dropped below AA.
                      working.has(day.weekday) ? "font-bold" : "font-semibold",
                    )}
                  >
                    {day.label}
                  </span>
                ))}

                {/* Keyed by the trailing day of the previous month each blank
                    stands in for, so the key is stable and never an index. */}
                {Array.from({ length: leadingBlanks(first) }, (_, i) =>
                  addDaysIso(first, i - leadingBlanks(first)),
                ).map((filler) => (
                  <span key={filler} aria-hidden />
                ))}

                {days.map((date) => {
                  const holiday = byDate.get(date) ?? null;
                  const offDay = !working.has(isoWeekday(date));
                  const isToday = date === today;
                  const dayNumber = Number(date.slice(8));

                  const cellClass = cn(
                    "relative flex h-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                    holiday
                      ? "bg-chip font-semibold text-foreground"
                      : offDay
                        ? "bg-muted text-muted-foreground"
                        : "text-foreground",
                    isToday &&
                      "ring-1 ring-primary ring-offset-1 ring-offset-card",
                    canManage && "hover:bg-accent hover:text-accent-foreground",
                  );

                  // Colour alone never carries the meaning: the marked days
                  // also get a dot and say so in their accessible name.
                  const marker = holiday ? (
                    <span
                      aria-hidden
                      className="absolute bottom-0.5 size-1 rounded-full bg-brand"
                    />
                  ) : null;

                  const description = holiday
                    ? `${formatIsoShort(date, `${year}-01-01`)} — ${holiday.name}, non-working day`
                    : `${formatIsoShort(date, `${year}-01-01`)}${offDay ? " — outside the working week" : ""}`;

                  if (!canManage) {
                    return (
                      <span
                        key={date}
                        title={description}
                        className={cellClass}
                      >
                        {dayNumber}
                        {holiday ? (
                          <span className="sr-only">{` — ${holiday.name}, non-working day`}</span>
                        ) : null}
                        {marker}
                      </span>
                    );
                  }

                  return (
                    <button
                      key={date}
                      type="button"
                      title={description}
                      aria-label={
                        holiday
                          ? `${description}. Select to remove.`
                          : `${description}. Select to mark as non-working.`
                      }
                      aria-pressed={holiday ? true : undefined}
                      onClick={() => onSelectDay({ date, holiday })}
                      className={cellClass}
                    >
                      {dayNumber}
                      {marker}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="relative flex size-4 items-center justify-center rounded-sm bg-chip">
            <span className="size-1 rounded-full bg-brand" />
          </span>
          Non-working day on this calendar
        </span>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-sm bg-muted" />
          Outside the working week
        </span>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-sm ring-1 ring-primary" />
          Today
        </span>
        {canManage ? <span>Select any day to add or remove it.</span> : null}
      </div>
    </div>
  );
}
