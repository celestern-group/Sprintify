"use client";

import { IconBeach, IconUsers } from "@tabler/icons-react";
import { useMemo } from "react";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LEAVE_TYPE_LABELS, type LeaveType } from "@/db/schema/calendar";
import { usePersistedState } from "@/hooks/use-persisted-state";
import type { LeaveRow } from "@/lib/actions/leave";
import {
  addDaysIso,
  daysBetweenIso,
  formatIsoShort,
  isoWeekday,
  todayIso,
} from "@/lib/date-only";

const HORIZONS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 182 },
];

const TYPE_TONE: Record<string, string> = {
  vacation: "bg-chart-2",
  sick: "bg-destructive",
  personal: "bg-chart-1",
  training: "bg-success",
  other: "bg-muted-foreground",
};

/** How a person reached this roster. `project` holds a projectMember row;
 * `you` is the caller; `admin` is an org owner/admin with implicit access. */
export type AvailabilityPerson = {
  id: string;
  name: string;
  email: string;
  kind: "project" | "admin" | "you";
};

const KIND_BADGE: Record<AvailabilityPerson["kind"], string | null> = {
  project: null,
  you: "You",
  admin: "Org admin",
};

/**
 * Who on this project is away, when — a read-only lane per person across a
 * rolling window, rendered as a card so it can sit under the caller's own
 * availability on the same page.
 *
 * Deliberately not a Gantt: this is one bar type on a fixed horizon with no
 * interaction, so a CSS grid renders it without shipping a drag library to a
 * page that has nothing to drag. Notes are never included in the data for
 * anyone but their author (see listLeave), so nothing personal is shown here.
 */
export function TeamAvailability({
  members,
  leave,
  projectMemberCount,
}: {
  members: AvailabilityPerson[];
  leave: LeaveRow[];
  /** How many of `members` are on the project by a project role rather than by
   * org rights — only the empty state cares. */
  projectMemberCount: number;
}) {
  // Stored as the day count rather than the option object — the labels are
  // display copy and will get reworded, the horizons themselves won't.
  const [horizonDays, setHorizonDays] = usePersistedState<number>(
    "availability.horizonDays",
    HORIZONS[1].days,
    (raw) =>
      typeof raw === "number" && HORIZONS.some((option) => option.days === raw)
        ? raw
        : null,
  );
  const horizon =
    HORIZONS.find((option) => option.days === horizonDays) ?? HORIZONS[1];
  const today = todayIso();
  const end = addDaysIso(today, horizon.days);
  const totalDays = daysBetweenIso(today, end);

  const byMember = useMemo(() => {
    const map = new Map<string, LeaveRow[]>();
    for (const row of leave) {
      if (row.status === "cancelled") continue;
      if (row.endDate < today || row.startDate > end) continue;
      const list = map.get(row.memberId) ?? [];
      list.push(row);
      map.set(row.memberId, list);
    }
    return map;
  }, [leave, today, end]);

  const withLeave = members.filter((row) => byMember.has(row.id));

  // Month boundaries for the axis, so the bars have something to read against.
  const monthMarks = useMemo(() => {
    const marks: { offset: number; label: string }[] = [];
    for (let index = 0; index < totalDays; index += 1) {
      const date = addDaysIso(today, index);
      if (date.endsWith("-01") || index === 0) {
        marks.push({
          offset: (index / totalDays) * 100,
          label: formatIsoShort(date, today),
        });
      }
    }
    return marks;
  }, [today, totalDays]);

  return (
    <SectionCard
      title="Who's away on this project"
      description={`${formatIsoShort(today)} – ${formatIsoShort(end)}`}
      action={
        <fieldset className="flex items-center gap-1.5 border-0 p-0">
          {HORIZONS.map((option) => (
            <Button
              key={option.days}
              size="sm"
              variant={option.days === horizon.days ? "secondary" : "outline"}
              aria-pressed={option.days === horizon.days}
              onClick={() => setHorizonDays(option.days)}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>
      }
    >
      {withLeave.length === 0 ? (
        /* An empty roster and an empty calendar look identical here, so they
           get different copy — "nobody booked anything" is a lie when nobody
           is on the project to book anything. */
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="grid size-11 place-items-center rounded-md bg-chip text-brand">
            {members.length === 0 ? (
              <IconUsers className="size-5" />
            ) : (
              <IconBeach className="size-5" />
            )}
          </div>
          <p className="text-sm font-semibold">
            {members.length === 0
              ? "Nobody is on this project yet"
              : "Nobody is away"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {members.length === 0
              ? "Add people to the project and their time off shows up here."
              : projectMemberCount === 0
                ? "Nothing booked in this window by you or the org admins who can see this project. Add people to the project and their time off shows up here too."
                : "Nothing booked in this window by anyone on this project."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[36rem]">
            <div className="relative mb-2 ml-44 h-4 border-b border-border">
              {monthMarks.map((mark) => (
                <span
                  key={mark.label}
                  className="absolute -translate-x-1/2 text-[11px] font-semibold tabular-nums text-muted-foreground"
                  style={{ left: `${mark.offset}%` }}
                >
                  {mark.label}
                </span>
              ))}
            </div>

            <ul className="flex flex-col gap-1.5">
              {withLeave.map((person) => {
                const rows = byMember.get(person.id) ?? [];
                return (
                  <li key={person.id} className="flex items-center gap-2">
                    <span className="flex w-42 shrink-0 items-center gap-1.5 overflow-hidden text-sm">
                      <span className="min-w-0 truncate">{person.name}</span>
                      {KIND_BADGE[person.kind] ? (
                        <Badge variant="neutral" className="shrink-0">
                          {KIND_BADGE[person.kind]}
                        </Badge>
                      ) : null}
                    </span>
                    <div className="relative h-7 flex-1 rounded-md bg-muted">
                      {/* Weekend shading, so a bar spanning a weekend
                          doesn't read as five working days. */}
                      {Array.from({ length: totalDays }, (_, index) => {
                        const date = addDaysIso(today, index);
                        const weekday = isoWeekday(date);
                        if (weekday !== 0 && weekday !== 6) return null;
                        return (
                          <span
                            key={date}
                            aria-hidden
                            className="absolute inset-y-0 bg-chip"
                            style={{
                              left: `${(index / totalDays) * 100}%`,
                              width: `${(1 / totalDays) * 100}%`,
                            }}
                          />
                        );
                      })}
                      {rows.map((row) => {
                        const startOffset = Math.max(
                          0,
                          daysBetweenIso(today, row.startDate) - 1,
                        );
                        const span = Math.min(
                          daysBetweenIso(
                            row.startDate < today ? today : row.startDate,
                            row.endDate > end ? end : row.endDate,
                          ),
                          totalDays - startOffset,
                        );
                        const label = `${
                          LEAVE_TYPE_LABELS[row.type as LeaveType] ?? row.type
                        }, ${formatIsoShort(row.startDate)} to ${formatIsoShort(
                          row.endDate,
                        )}`;
                        return (
                          <span
                            key={row.id}
                            // role="img" + a label is what makes each bar
                            // legible to a screen reader; the list fallback
                            // below repeats the same information as text.
                            role="img"
                            title={label}
                            aria-label={`${person.name}: ${label}`}
                            className={`absolute inset-y-1 flex items-center overflow-hidden rounded-sm px-1.5 text-[10px] font-bold text-background ${
                              TYPE_TONE[row.type] ?? TYPE_TONE.other
                            }`}
                            style={{
                              left: `${(startOffset / totalDays) * 100}%`,
                              width: `${Math.max((span / totalDays) * 100, 1)}%`,
                            }}
                          >
                            {span / totalDays > 0.08
                              ? (LEAVE_TYPE_LABELS[row.type as LeaveType] ??
                                row.type)
                              : null}
                          </span>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Text fallback for the chart above — the bars are not the only way
          to read this data. */}
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
          View as a list
        </summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {withLeave.flatMap((person) =>
            (byMember.get(person.id) ?? []).map((row) => (
              <li key={row.id} className="tabular-nums">
                <span className="font-semibold">{person.name}</span>
                {KIND_BADGE[person.kind] ? (
                  <span className="text-muted-foreground">
                    {" "}
                    ({KIND_BADGE[person.kind]})
                  </span>
                ) : null}{" "}
                — {LEAVE_TYPE_LABELS[row.type as LeaveType] ?? row.type},{" "}
                {formatIsoShort(row.startDate)} to {formatIsoShort(row.endDate)}
              </li>
            )),
          )}
        </ul>
      </details>
    </SectionCard>
  );
}
