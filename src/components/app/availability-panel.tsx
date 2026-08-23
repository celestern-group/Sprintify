"use client";

import {
  IconBeach,
  IconCalendarPlus,
  IconCalendarWeek,
  IconClock,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState, useTransition } from "react";
import { PageHeader } from "@/components/app/page-header";
import { ScopeNotice } from "@/components/app/scope-notice";
import {
  type AvailabilityPerson,
  TeamAvailability,
} from "@/components/app/team-availability";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { StatCard } from "@/components/dashboard/ui/stat-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { LEAVE_TYPE_LABELS, type LeaveType } from "@/db/schema/calendar";
import {
  type CapacityProfile,
  createLeave,
  deleteLeave,
  type LeaveRow,
  updateLeave,
  upsertCapacityProfile,
} from "@/lib/actions/leave";
import {
  addDaysIso,
  compareIso,
  daysBetweenIso,
  formatIsoShort,
  isoToLocalDate,
  isoWeekday,
  localDateToIso,
  todayIso,
} from "@/lib/date-only";
import { cn } from "@/lib/utils";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/** Leave type as a v0.3 lozenge — neutral chip, colour in the dot only. */
const LEAVE_VARIANT: Record<
  string,
  "info" | "destructive" | "default" | "success" | "neutral"
> = {
  vacation: "info",
  sick: "destructive",
  personal: "default",
  training: "success",
  other: "neutral",
};

/** Dot beside a type chip — the label carries the meaning, the dot only
 * echoes the colour the leave list already uses. */
const LEAVE_DOT: Record<string, string> = {
  vacation: "bg-chart-2",
  sick: "bg-destructive",
  personal: "bg-brand",
  training: "bg-success",
  other: "bg-muted-foreground",
};

/** Working days inside an inclusive range, per the member's own pattern.
 * Public holidays are unknown on the client, so this is an upper bound — the
 * summary says so rather than pretending it is the final deduction. */
function workingDaysBetween(
  start: string,
  end: string,
  workingWeekdays: number[],
) {
  if (compareIso(start, end) > 0) return 0;
  let total = 0;
  for (let day = start; compareIso(day, end) <= 0; day = addDaysIso(day, 1)) {
    if (workingWeekdays.includes(isoWeekday(day))) total += 1;
  }
  return total;
}

function rangeLabel(start: string, end: string) {
  if (start === end) return formatIsoShort(start);
  return `${formatIsoShort(start, end)} – ${formatIsoShort(end)}`;
}

/** Monday of next week, so "Next week" means the same thing on a Sunday as it
 * does on a Wednesday. */
function nextMondayIso(from: string) {
  const shift = (1 - isoWeekday(from) + 7) % 7;
  return addDaysIso(from, shift === 0 ? 7 : shift);
}

function rangePresets(today: string) {
  const nextMonday = nextMondayIso(today);
  return [
    { label: "Today", start: today, end: today },
    {
      label: "Tomorrow",
      start: addDaysIso(today, 1),
      end: addDaysIso(today, 1),
    },
    { label: "Next 7 days", start: today, end: addDaysIso(today, 6) },
    { label: "Next week", start: nextMonday, end: addDaysIso(nextMonday, 4) },
  ];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

type LeaveDraft = {
  id?: string;
  startDate: string;
  endDate: string;
  portion: 1 | 0.5;
  type: LeaveType;
  note: string;
};

function emptyDraft(): LeaveDraft {
  const today = todayIso();
  return {
    startDate: today,
    endDate: today,
    portion: 1,
    type: "vacation",
    note: "",
  };
}

export function AvailabilityPanel({
  organizationId,
  memberId,
  projectKey,
  initialProfile,
  initialLeave,
  team,
  calendars,
  defaultCalendarName,
}: {
  organizationId: string;
  /** The caller's own `member` row — the leave list is filtered to it. */
  memberId: string;
  projectKey: string;
  initialProfile: CapacityProfile;
  initialLeave: LeaveRow[];
  /** Everyone who can see this project — project members plus the caller and
   * the org owners/admins who reach it without a project role — and their
   * leave. Null without capacity:view. */
  team: {
    members: AvailabilityPerson[];
    /** How many of `members` hold an actual projectMember row, so the empty
     * state can tell "no roster" from "nobody booked anything". */
    projectMemberCount: number;
    leave: LeaveRow[];
  } | null;
  calendars: { id: string; name: string; isDefault: boolean }[];
  defaultCalendarName: string | null;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [leave, setLeave] = useState(initialLeave);
  const [draft, setDraft] = useState<LeaveDraft | null>(null);
  const [pending, startTransition] = useTransition();

  const today = todayIso();
  const upcoming = useMemo(
    () => leave.filter((row) => row.endDate >= today),
    [leave, today],
  );
  const past = useMemo(
    () => leave.filter((row) => row.endDate < today),
    [leave, today],
  );

  async function refresh() {
    const { listLeave, getCapacityProfile } = await import(
      "@/lib/actions/leave"
    );
    const [nextLeave, nextProfile] = await Promise.all([
      listLeave({ organizationId, memberId }),
      getCapacityProfile({ organizationId }),
    ]);
    setLeave(nextLeave);
    setProfile(nextProfile);
  }

  function run(work: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await work();
        await refresh();
        toast.success(success);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  function toggleWeekday(value: number) {
    const next = profile.workingWeekdays.includes(value)
      ? profile.workingWeekdays.filter((day) => day !== value)
      : [...profile.workingWeekdays, value].sort((a, b) => a - b);
    if (next.length === 0) {
      toast.error("Keep at least one working day.");
      return;
    }
    setProfile({ ...profile, workingWeekdays: next });
  }

  const draftDays = draft ? daysBetweenIso(draft.startDate, draft.endDate) : 0;
  const draftWorkingDays = draft
    ? Math.round(
        workingDaysBetween(
          draft.startDate,
          draft.endDate,
          profile.workingWeekdays,
        ) *
          draft.portion *
          10,
      ) / 10
    : 0;

  const upcomingDays = upcoming.reduce(
    (total, row) =>
      total + daysBetweenIso(row.startDate, row.endDate) * row.portion,
    0,
  );
  const weeklyHours =
    Math.round(profile.hoursPerDay * profile.workingWeekdays.length * 10) / 10;

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow={projectKey}
        title="Availability"
        description="Your working pattern and time off, plus who else on this project is away. Sprint capacity is calculated from this, so keep it current."
      >
        <Button onClick={() => setDraft(emptyDraft())}>
          <IconCalendarPlus className="size-4" />
          Book time off
        </Button>
      </PageHeader>
      <ScopeNotice>
        You have one working pattern and one set of time off across the whole
        organization — editing them here changes them on every project you're
        on, not just this one.
      </ScopeNotice>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Hours per day"
          value={profile.hoursPerDay}
          icon={IconClock}
          foot={`${weeklyHours}h a week`}
        />
        <StatCard
          label="Working days"
          value={`${profile.workingWeekdays.length}/7`}
          icon={IconCalendarWeek}
          tone="blue"
          foot={WEEKDAYS.filter((day) =>
            profile.workingWeekdays.includes(day.value),
          )
            .map((day) => day.label)
            .join(" · ")}
        />
        <StatCard
          label="Time off booked"
          value={upcomingDays}
          icon={IconBeach}
          tone="amber"
          foot={
            upcoming.length === 0
              ? "Nothing upcoming"
              : `${upcoming.length} booking${upcoming.length === 1 ? "" : "s"} ahead`
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <SectionCard
          title="Working pattern"
          description="Applied to every project you're on. A project's own working week still takes precedence where they differ."
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="hours-per-day">
                Hours per working day
              </FieldLabel>
              <Input
                id="hours-per-day"
                type="number"
                min={0}
                max={24}
                step={0.5}
                className="w-32 tabular-nums"
                value={profile.hoursPerDay}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    hoursPerDay: Number(event.target.value),
                  })
                }
              />
            </Field>

            <Field>
              <FieldLabel>Working days</FieldLabel>
              <fieldset className="flex flex-wrap gap-1.5 border-0 p-0">
                {WEEKDAYS.map((day) => {
                  const on = profile.workingWeekdays.includes(day.value);
                  return (
                    <Button
                      key={day.value}
                      type="button"
                      size="sm"
                      variant={on ? "secondary" : "outline"}
                      aria-pressed={on}
                      onClick={() => toggleWeekday(day.value)}
                    >
                      {day.label}
                    </Button>
                  );
                })}
              </fieldset>
            </Field>

            <Field>
              <FieldLabel htmlFor="holiday-calendar">
                Holiday calendar
              </FieldLabel>
              <NativeSelect
                id="holiday-calendar"
                value={profile.holidayCalendarId ?? ""}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    holidayCalendarId: event.target.value || null,
                  })
                }
              >
                <option value="">
                  {defaultCalendarName
                    ? `Project or organization default (${defaultCalendarName})`
                    : "Project or organization default"}
                </option>
                {calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>

          <div className="mt-4 flex justify-end border-t border-border pt-3">
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    upsertCapacityProfile({
                      organizationId,
                      hoursPerDay: profile.hoursPerDay,
                      workingWeekdays: profile.workingWeekdays,
                      holidayCalendarId: profile.holidayCalendarId,
                    }),
                  "Working pattern saved.",
                )
              }
            >
              {pending ? <Spinner className="size-4" /> : null}
              Save pattern
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Time off"
          description="Planned leave is subtracted from your capacity on every sprint it touches."
        >
          {upcoming.length === 0 && past.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="grid size-11 place-items-center rounded-md bg-chip text-brand">
                <IconBeach className="size-5" />
              </div>
              <p className="text-sm font-semibold">No time off booked</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Book leave here and every sprint that overlaps it recalculates
                your capacity automatically.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <LeaveList
                title="Upcoming"
                rows={upcoming}
                onEdit={(row) =>
                  setDraft({
                    id: row.id,
                    startDate: row.startDate,
                    endDate: row.endDate,
                    portion: row.portion === 0.5 ? 0.5 : 1,
                    type: row.type as LeaveType,
                    note: row.note ?? "",
                  })
                }
                onDelete={(row) =>
                  run(
                    () => deleteLeave({ leaveId: row.id }),
                    "Time off removed.",
                  )
                }
              />
              {past.length > 0 ? (
                <LeaveList title="Past" rows={past} muted />
              ) : null}
            </div>
          )}
        </SectionCard>
      </div>

      {team ? (
        <TeamAvailability
          members={team.members}
          leave={team.leave}
          projectMemberCount={team.projectMemberCount}
        />
      ) : null}

      <Dialog
        open={draft !== null}
        onOpenChange={(next) => {
          if (!next) setDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-chip text-brand"
              >
                <IconBeach className="size-5" />
              </span>
              <DialogTitle>
                {draft?.id ? "Edit time off" : "Book time off"}
              </DialogTitle>
            </div>
            <DialogDescription>
              Pick the first and last day. Non-working days and public holidays
              inside the range aren&apos;t counted twice.
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            /* Two columns from sm up: the calendar keeps its natural width and
               the fields take the rest, so the extra dialog width goes into
               content instead of margin. Stacks on mobile. */
            <div className="grid gap-5 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {rangePresets(today).map((preset) => {
                    const on =
                      draft.startDate === preset.start &&
                      draft.endDate === preset.end;
                    return (
                      <Button
                        key={preset.label}
                        type="button"
                        size="sm"
                        variant={on ? "secondary" : "outline"}
                        aria-pressed={on}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            startDate: preset.start,
                            endDate: preset.end,
                          })
                        }
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>

                <div className="flex justify-center rounded-xl border border-border bg-muted p-1">
                  <Calendar
                    mode="range"
                    autoFocus
                    selected={{
                      from: isoToLocalDate(draft.startDate),
                      to: isoToLocalDate(draft.endDate),
                    }}
                    onSelect={(range) => {
                      if (!range?.from) return;
                      const from = localDateToIso(range.from);
                      setDraft({
                        ...draft,
                        startDate: from,
                        endDate: range.to ? localDateToIso(range.to) : from,
                      });
                    }}
                    className="bg-transparent [--cell-size:--spacing(9)]"
                  />
                </div>
              </div>

              <FieldGroup>
                <Field>
                  <FieldLabel id="leave-type-label">Type</FieldLabel>
                  {/* Native selects can't tint an option, and the type colour is
                    the same language the leave list speaks — so this is a chip
                    row with the label always spelled out. */}
                  <fieldset
                    aria-labelledby="leave-type-label"
                    className="flex w-full min-w-0 flex-wrap gap-1 rounded-lg border-0 bg-muted p-1"
                  >
                    {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => {
                      const on = draft.type === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setDraft({ ...draft, type: value as LeaveType })
                          }
                          className={cn(
                            "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on
                              ? "bg-secondary text-secondary-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-2 rounded-full",
                              LEAVE_DOT[value] ?? LEAVE_DOT.other,
                            )}
                          />
                          {label}
                        </button>
                      );
                    })}
                  </fieldset>
                </Field>

                <Field>
                  <FieldLabel id="leave-portion-label">Each day</FieldLabel>
                  <fieldset
                    aria-labelledby="leave-portion-label"
                    className="grid w-full min-w-0 grid-cols-2 gap-1 rounded-lg border-0 bg-muted p-1"
                  >
                    {(
                      [
                        { value: 1, label: "Full day" },
                        { value: 0.5, label: "Half day" },
                      ] as const
                    ).map((option) => {
                      const on = draft.portion === option.value;
                      return (
                        <button
                          key={option.label}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setDraft({ ...draft, portion: option.value })
                          }
                          className={cn(
                            "h-7 cursor-pointer rounded-md text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on
                              ? "bg-secondary text-secondary-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </fieldset>
                </Field>

                <Field>
                  <FieldLabel htmlFor="leave-note">Note (optional)</FieldLabel>
                  <Textarea
                    id="leave-note"
                    rows={2}
                    value={draft.note}
                    onChange={(event) =>
                      setDraft({ ...draft, note: event.target.value })
                    }
                    placeholder="Only you can see this."
                  />
                </Field>

                <div className="flex flex-col gap-1.5 sm:mt-auto">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-2.5 text-foreground">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[11px] font-bold uppercase tracking-[0.09em]">
                        {draft.id ? "Updated booking" : "Booking"}
                      </span>
                      <span className="truncate text-sm font-semibold tabular-nums">
                        {rangeLabel(draft.startDate, draft.endDate)}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <span className="text-lg font-bold leading-none tabular-nums">
                        {draftWorkingDays}
                      </span>
                      <span className="text-[11px]">
                        working day{draftWorkingDays === 1 ? "" : "s"} off
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {draftDays} day{draftDays === 1 ? "" : "s"} of calendar time
                    · public holidays in the range come off this too
                  </p>
                </div>
              </FieldGroup>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if (!draft) return;
                run(
                  async () => {
                    if (draft.id) {
                      await updateLeave({
                        leaveId: draft.id,
                        startDate: draft.startDate,
                        endDate: draft.endDate,
                        portion: draft.portion,
                        type: draft.type,
                        status: "planned",
                        note: draft.note,
                      });
                    } else {
                      await createLeave({
                        organizationId,
                        startDate: draft.startDate,
                        endDate: draft.endDate,
                        portion: draft.portion,
                        type: draft.type,
                        note: draft.note,
                      });
                    }
                    setDraft(null);
                  },
                  draft.id ? "Time off updated." : "Time off booked.",
                );
              }}
            >
              {pending ? <Spinner className="size-4" /> : null}
              {draft?.id ? "Save" : "Book"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function LeaveList({
  title,
  rows,
  muted = false,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: LeaveRow[];
  muted?: boolean;
  onEdit?: (row: LeaveRow) => void;
  onDelete?: (row: LeaveRow) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => {
          const days = daysBetweenIso(row.startDate, row.endDate) * row.portion;
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  {/* Past rows dim their text only — a row-level opacity would
                      wash the action buttons out too. */}
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      muted && "text-muted-foreground",
                    )}
                  >
                    {formatIsoShort(row.startDate)}
                    {row.startDate === row.endDate
                      ? ""
                      : ` – ${formatIsoShort(row.endDate)}`}
                  </span>
                  {/* Type carries a text label, not just a dot — colour is
                      never the only signal. */}
                  <Badge variant={LEAVE_VARIANT[row.type] ?? "neutral"}>
                    {LEAVE_TYPE_LABELS[row.type as LeaveType] ?? row.type}
                  </Badge>
                  {row.portion === 0.5 ? (
                    <Badge variant="outline">Half days</Badge>
                  ) : null}
                </span>
                {row.note ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {row.note}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {days} day{days === 1 ? "" : "s"}
                </span>
                {onEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit time off"
                    onClick={() => onEdit(row)}
                  >
                    <IconPencil className="size-4" />
                  </Button>
                ) : null}
                {onDelete ? (
                  <ConfirmDialog
                    title="Remove this time off?"
                    description="Sprint capacity for the days it covered is given back."
                    confirmLabel="Remove"
                    variant="destructive"
                    onConfirm={() => onDelete(row)}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove time off"
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    }
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
