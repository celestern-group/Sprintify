"use client";

import {
  IconCalendarEvent,
  IconCalendarMonth,
  IconCalendarPlus,
  IconCheck,
  IconList,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  type CalendarDaySelection,
  CalendarYearGrid,
} from "@/components/app/calendar-year-grid";
import { PageHeader } from "@/components/app/page-header";
import { ScopeNotice } from "@/components/app/scope-notice";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  addHolidays,
  type CalendarSummary,
  createCalendar,
  deleteCalendar,
  getCalendars,
  getHolidays,
  type HolidayRow,
  removeHoliday,
  setDefaultCalendar,
  updateCalendar,
} from "@/lib/actions/holidays";
import { formatIsoShort } from "@/lib/date-only";
import { parseHolidayLines } from "@/lib/validation/calendar";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const YEAR_SPAN = 3;

/** Paste box for bulk-adding dates — the realistic way a year of public
 * holidays gets in. Parses live so bad lines are visible before submitting. */
function AddHolidaysDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (rows: { date: string; name: string }[]) => void;
  pending: boolean;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseHolidayLines(text), [text]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add non-working days</DialogTitle>
          <DialogDescription>
            One per line, as <code>2026-01-01, New Year&apos;s Day</code>. Dates
            already on the calendar are skipped.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="holiday-lines">Dates</FieldLabel>
            <Textarea
              id="holiday-lines"
              rows={8}
              value={text}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              placeholder={"2026-01-01, New Year's Day\n2026-12-25, Christmas"}
            />
          </Field>
          {parsed.holidays.length > 0 || parsed.errors.length > 0 ? (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold tabular-nums">
                {parsed.holidays.length} date
                {parsed.holidays.length === 1 ? "" : "s"} ready
              </span>
              {parsed.errors.map((row) => (
                <span key={row.line} className="text-destructive">
                  Line {row.line}: {row.reason}
                </span>
              ))}
            </div>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || parsed.holidays.length === 0}
            onClick={() => {
              onSubmit(parsed.holidays);
              setText("");
            }}
          >
            {pending ? <Spinner className="size-4" /> : null}
            Add {parsed.holidays.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mon–Fri — purely a visual default for shading the month grid, since this
 * page has no single project's working week to reflect. */
const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5];

export function CalendarsPanel({
  organizationId,
  initialCalendars,
  canManage,
  timezones,
}: {
  organizationId: string;
  initialCalendars: CalendarSummary[];
  canManage: boolean;
  timezones: string[];
}) {
  const [calendars, setCalendars] = useState(initialCalendars);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialCalendars.find((c) => c.isDefault)?.id ?? initialCalendars[0]?.id,
  );
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [holidayError, setHolidayError] = useState(false);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [day, setDay] = useState<CalendarDaySelection | null>(null);
  const [dayName, setDayName] = useState("");
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [pending, startTransition] = useTransition();

  const selected = calendars.find((c) => c.id === selectedId);

  const refreshCalendars = useCallback(async () => {
    setCalendars(await getCalendars(organizationId));
  }, [organizationId]);

  const loadHolidays = useCallback(
    async (calendarId: string, forYear: number) => {
      setLoadingHolidays(true);
      try {
        setHolidays(await getHolidays({ calendarId, year: forYear }));
        setHolidayError(false);
      } catch (error) {
        setHolidayError(true);
        toast.error(errorMessage(error));
      } finally {
        setLoadingHolidays(false);
      }
    },
    [],
  );

  // Load whenever the selected calendar or year changes.
  useEffect(() => {
    if (selectedId) void loadHolidays(selectedId, year);
  }, [selectedId, year, loadHolidays]);

  const years = Array.from(
    { length: YEAR_SPAN * 2 + 1 },
    (_, index) => new Date().getFullYear() - YEAR_SPAN + index,
  );

  function run(work: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(success);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Working time"
        description="Shared calendars of non-working days. Sprint capacity subtracts them for everyone the calendar applies to."
      >
        {canManage ? (
          <Button
            onClick={() => {
              setName("");
              setTimezone("UTC");
              setCreateOpen(true);
            }}
          >
            <IconPlus className="size-4" />
            New calendar
          </Button>
        ) : null}
      </PageHeader>
      <ScopeNotice>
        Every calendar below is shared — editing one changes the working days of
        every project pointing at it. Each project picks which calendar it uses
        under its own Cadence settings.
      </ScopeNotice>

      {calendars.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="grid size-11 place-items-center rounded-md bg-chip text-brand">
              <IconCalendarEvent className="size-5" />
            </div>
            <p className="text-sm font-semibold">No calendars yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a calendar of public holidays and shutdown days, then point
              your projects at it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Calendars</CardTitle>
              <CardDescription>
                Projects inherit the default unless they pin their own.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {calendars.map((calendar) => {
                const active = calendar.id === selectedId;
                return (
                  <button
                    key={calendar.id}
                    type="button"
                    onClick={() => setSelectedId(calendar.id)}
                    aria-current={active ? "true" : undefined}
                    className={
                      active
                        ? "flex w-full flex-col gap-0.5 rounded-lg bg-secondary px-3 py-2 text-left text-sm font-semibold text-secondary-foreground"
                        : "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate">{calendar.name}</span>
                      {calendar.isDefault ? (
                        <Badge variant="secondary" className="shrink-0">
                          Default
                        </Badge>
                      ) : null}
                    </span>
                    <span
                      className={
                        active
                          ? "text-xs font-normal tabular-nums"
                          : "text-xs font-normal tabular-nums text-muted-foreground"
                      }
                    >
                      {calendar.holidayCount} day
                      {calendar.holidayCount === 1 ? "" : "s"} ·{" "}
                      {calendar.projectCount} project
                      {calendar.projectCount === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate">
                  {selected?.name ?? "Calendar"}
                </CardTitle>
                <CardDescription>
                  {selected?.timezone} · {holidays.length} day
                  {holidays.length === 1 ? "" : "s"} in {year}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant={view === "calendar" ? "secondary" : "ghost"}
                    size="icon"
                    aria-label="Calendar view"
                    aria-pressed={view === "calendar"}
                    onClick={() => setView("calendar")}
                  >
                    <IconCalendarMonth className="size-4" />
                  </Button>
                  <Button
                    variant={view === "list" ? "secondary" : "ghost"}
                    size="icon"
                    aria-label="List view"
                    aria-pressed={view === "list"}
                    onClick={() => setView("list")}
                  >
                    <IconList className="size-4" />
                  </Button>
                </div>
                <NativeSelect
                  aria-label="Year"
                  value={String(year)}
                  onChange={(event) => setYear(Number(event.target.value))}
                  className="w-24"
                >
                  {years.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeSelect>
                {canManage && selected ? (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Edit calendar"
                      onClick={() => {
                        setName(selected.name);
                        setTimezone(selected.timezone);
                        setEditOpen(true);
                      }}
                    >
                      <IconPencil className="size-4" />
                    </Button>
                    {!selected.isDefault ? (
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Make default"
                        onClick={() =>
                          run(async () => {
                            await setDefaultCalendar({
                              calendarId: selected.id,
                            });
                            await refreshCalendars();
                          }, "Default calendar updated.")
                        }
                      >
                        <IconCheck className="size-4" />
                      </Button>
                    ) : null}
                    <ConfirmDialog
                      title={`Delete ${selected.name}?`}
                      description="Projects using it fall back to the organization default. Sprint capacity is recalculated."
                      confirmLabel="Delete"
                      variant="destructive"
                      onConfirm={async () => {
                        await deleteCalendar({ calendarId: selected.id });
                        await refreshCalendars();
                        setSelectedId(
                          calendars.find((c) => c.id !== selected.id)?.id,
                        );
                      }}
                      trigger={
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Delete calendar"
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      }
                    />
                    <Button onClick={() => setAddOpen(true)}>
                      <IconCalendarPlus className="size-4" />
                      Add days
                    </Button>
                  </>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {loadingHolidays ? (
                // Shaped like the resting 12-month grid, so nothing jumps
                // when the real months arrive.
                <div
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                  aria-hidden
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => (
                    <div
                      key={month}
                      className="h-40 animate-pulse rounded-md bg-muted"
                    />
                  ))}
                </div>
              ) : holidayError ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-sm font-semibold">
                    Couldn&apos;t load these days
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Something went wrong fetching the non-working days for{" "}
                    {year}.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (selectedId) void loadHolidays(selectedId, year);
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : view === "calendar" ? (
                <CalendarYearGrid
                  year={year}
                  holidays={holidays}
                  workingWeekdays={DEFAULT_WORKING_WEEKDAYS}
                  timezone={selected?.timezone ?? "UTC"}
                  canManage={canManage}
                  onSelectDay={(selection) => {
                    setDay(selection);
                    setDayName(selection.holiday?.name ?? "");
                  }}
                />
              ) : holidays.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="grid size-11 place-items-center rounded-md bg-chip text-brand">
                    <IconCalendarEvent className="size-5" />
                  </div>
                  <p className="text-sm font-semibold">
                    No non-working days in {year}
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Public holidays and shutdown days added to this calendar
                    show up here.
                  </p>
                  {canManage && selected ? (
                    <Button onClick={() => setAddOpen(true)}>
                      <IconCalendarPlus className="size-4" />
                      Add days
                    </Button>
                  ) : null}
                </div>
              ) : (
                // Dates are short strings; at full width they read far better
                // in columns than as one long single-file list.
                <ul className="grid gap-x-8 sm:grid-cols-2 2xl:grid-cols-3">
                  {holidays.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 border-b border-border py-2"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="w-24 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                          {formatIsoShort(row.date)}
                        </span>
                        <span className="truncate text-sm">{row.name}</span>
                      </div>
                      {canManage && selected ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${row.name}`}
                          onClick={() =>
                            run(async () => {
                              await removeHoliday({
                                calendarId: selected.id,
                                holidayId: row.id,
                              });
                              await loadHolidays(selected.id, year);
                              await refreshCalendars();
                            }, "Day removed.")
                          }
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog
        open={createOpen || editOpen}
        onOpenChange={(next) => {
          if (!next) {
            setCreateOpen(false);
            setEditOpen(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createOpen ? "New calendar" : "Edit calendar"}
            </DialogTitle>
            <DialogDescription>
              A calendar is a named set of non-working days — typically one per
              country or site.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="calendar-name">Name</FieldLabel>
              <Input
                id="calendar-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="India — public holidays"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-tz">Time zone</FieldLabel>
              <NativeSelect
                id="calendar-tz"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={pending || name.trim().length === 0}
              onClick={() =>
                run(
                  async () => {
                    if (createOpen) {
                      await createCalendar({
                        organizationId,
                        name,
                        timezone,
                        isDefault: calendars.length === 0,
                      });
                    } else if (selected) {
                      await updateCalendar({
                        calendarId: selected.id,
                        name,
                        timezone,
                      });
                    }
                    await refreshCalendars();
                    setCreateOpen(false);
                    setEditOpen(false);
                  },
                  createOpen ? "Calendar created." : "Calendar updated.",
                )
              }
            >
              {pending ? <Spinner className="size-4" /> : null}
              {createOpen ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One dialog serves every cell in the month grid — the clicked day is
          state, not 365 mounted dialogs. Removing goes through it too, so a
          stray click on a marked day can't delete it outright. */}
      <Dialog
        open={day !== null}
        onOpenChange={(next) => {
          if (!next) setDay(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {day?.holiday ? "Non-working day" : "Mark as non-working"}
            </DialogTitle>
            <DialogDescription>
              {day ? formatIsoShort(day.date) : null}
              {selected ? ` · ${selected.name}` : null}
            </DialogDescription>
          </DialogHeader>
          {day?.holiday ? (
            <p className="text-sm">{day.holiday.name}</p>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="day-name">Name</FieldLabel>
                <Input
                  id="day-name"
                  value={dayName}
                  onChange={(event) => setDayName(event.target.value)}
                  placeholder="Public holiday"
                />
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDay(null)}>
              Cancel
            </Button>
            {day?.holiday ? (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    if (!selected || !day?.holiday) return;
                    await removeHoliday({
                      calendarId: selected.id,
                      holidayId: day.holiday.id,
                    });
                    await loadHolidays(selected.id, year);
                    await refreshCalendars();
                    setDay(null);
                  }, "Day removed.")
                }
              >
                {pending ? <Spinner className="size-4" /> : null}
                Remove
              </Button>
            ) : (
              <Button
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    if (!selected || !day) return;
                    await addHolidays({
                      calendarId: selected.id,
                      holidays: [
                        {
                          date: day.date,
                          name: dayName.trim() || "Non-working day",
                        },
                      ],
                    });
                    await loadHolidays(selected.id, year);
                    await refreshCalendars();
                    setDay(null);
                  }, "Non-working day added.")
                }
              >
                {pending ? <Spinner className="size-4" /> : null}
                Add
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddHolidaysDialog
        open={addOpen}
        pending={pending}
        onOpenChange={setAddOpen}
        onSubmit={(rows) =>
          run(async () => {
            if (!selected) return;
            await addHolidays({ calendarId: selected.id, holidays: rows });
            await loadHolidays(selected.id, year);
            await refreshCalendars();
            setAddOpen(false);
          }, "Non-working days added.")
        }
      />
    </PageContainer>
  );
}
