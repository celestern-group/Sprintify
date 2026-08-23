// The boundary between our date-only sprint records and Kibo's Gantt, which
// speaks native `Date`.
//
// This is the one place a Date is allowed to exist in the sprint feature, and
// it exists only because the library demands it. Every conversion goes through
// isoToLocalDate/localDateToIso, which pin the time to local noon — a sprint
// dragged in Los Angeles must not come back a day earlier than it was dropped.
//
// Kept out of the component so the conversion is unit-testable on its own.

import type { GanttFeature, GanttStatus } from "@/components/kibo-ui/gantt";
import type { SprintState } from "@/db/schema/sprints";
import { type IsoDate, isoToLocalDate, localDateToIso } from "@/lib/date-only";

export type TimelineSprint = {
  id: string;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  state: SprintState;
};

// Gantt colours are inline styles, so they can't read CSS variables the way
// the rest of the system does. These are the resolved v0.3 anchors: violet for
// active (the accent), amber for planning (pending), neutral for completed.
// They are the only hard-coded colours in the feature — keep them in step with
// --primary / --amber / --ink-3 if the palette moves.
const STATE_STATUS: Record<SprintState, GanttStatus> = {
  planning: { id: "planning", name: "Planning", color: "#ff930a" },
  active: { id: "active", name: "Active", color: "#6d4aff" },
  completed: { id: "completed", name: "Completed", color: "#6f6f77" },
};

export function sprintToFeature(sprint: TimelineSprint): GanttFeature {
  return {
    id: sprint.id,
    name: sprint.name,
    startAt: isoToLocalDate(sprint.startDate),
    // The Gantt treats endAt as the last day of the bar, which matches our
    // inclusive endDate — no ±1 fudge.
    endAt: isoToLocalDate(sprint.endDate),
    status: STATE_STATUS[sprint.state],
  };
}

/**
 * Turns a drag result back into stored dates.
 *
 * The Gantt hands back `endAt: Date | null` — null when a bar is dragged
 * without a resize — so the original length is preserved rather than guessed.
 */
export function featureToDates(
  startAt: Date,
  endAt: Date | null,
  fallback: { startDate: IsoDate; endDate: IsoDate },
): { startDate: IsoDate; endDate: IsoDate } {
  const startDate = localDateToIso(startAt);

  if (endAt) {
    const endDate = localDateToIso(endAt);
    // A drag that inverts the range is a mis-drop, not an instruction.
    return endDate >= startDate
      ? { startDate, endDate }
      : { startDate, endDate: startDate };
  }

  const lengthDays =
    (Date.parse(`${fallback.endDate}T00:00:00Z`) -
      Date.parse(`${fallback.startDate}T00:00:00Z`)) /
    86_400_000;
  const end = new Date(
    Date.parse(`${startDate}T00:00:00Z`) + lengthDays * 86_400_000,
  );
  const endDate = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  return { startDate, endDate };
}

export type TimelineMarker = { id: string; date: Date; label: string };

/** Holidays become markers, so the non-working days are visible while a sprint
 * bar is being placed rather than only after the capacity is recalculated. */
export function holidaysToMarkers(
  holidays: readonly { date: IsoDate; name: string }[],
): TimelineMarker[] {
  return holidays.map((row) => ({
    id: `holiday-${row.date}`,
    date: isoToLocalDate(row.date),
    label: row.name,
  }));
}
