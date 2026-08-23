"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { updateProjectCadence } from "@/lib/actions/sprints";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export function CadencePanel({
  project,
  basePath,
  calendars,
  defaultCalendarName,
  timezones,
}: {
  project: {
    id: string;
    key: string;
    capacityUnit: "hours" | "points";
    sprintLengthDays: number;
    defaultHoursPerDay: number;
    workingWeekdays: number[];
    timezone: string;
    holidayCalendarId: string | null;
  };
  basePath: string;
  calendars: { id: string; name: string }[];
  defaultCalendarName: string | null;
  timezones: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(project);
  const [pending, startTransition] = useTransition();

  function toggleWeekday(value: number) {
    const next = form.workingWeekdays.includes(value)
      ? form.workingWeekdays.filter((day) => day !== value)
      : [...form.workingWeekdays, value].sort((a, b) => a - b);
    if (next.length === 0) {
      toast.error("Keep at least one working day.");
      return;
    }
    setForm({ ...form, workingWeekdays: next });
  }

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow={project.key}
        title="Cadence"
        description="Defaults every new sprint is created from. Sprints that already exist keep the settings they were created with."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <SectionCard
          title="Sprint defaults"
          description="Changing these affects new sprints and recalculates the ones still in planning."
        >
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="capacity-unit">
                  Capacity is measured in
                </FieldLabel>
                <NativeSelect
                  id="capacity-unit"
                  className="w-full"
                  value={form.capacityUnit}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      capacityUnit: event.target.value as "hours" | "points",
                    })
                  }
                >
                  <option value="hours">Hours</option>
                  <option value="points">Story points</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="sprint-length">
                  Sprint length (days)
                </FieldLabel>
                <Input
                  id="sprint-length"
                  type="number"
                  min={1}
                  max={90}
                  className="w-32 tabular-nums"
                  value={form.sprintLengthDays}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      sprintLengthDays: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-hours">
                  Default hours per day
                </FieldLabel>
                <Input
                  id="default-hours"
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  className="w-32 tabular-nums"
                  value={form.defaultHoursPerDay}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      defaultHoursPerDay: Number(event.target.value),
                    })
                  }
                />
              </Field>
            </div>

            <Field>
              <FieldLabel>Working days</FieldLabel>
              <fieldset className="flex flex-wrap gap-1.5 border-0 p-0">
                {WEEKDAYS.map((day) => {
                  const on = form.workingWeekdays.includes(day.value);
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

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="project-tz">Time zone</FieldLabel>
                <NativeSelect
                  id="project-tz"
                  className="w-full"
                  value={form.timezone}
                  onChange={(event) =>
                    setForm({ ...form, timezone: event.target.value })
                  }
                >
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="project-calendar">
                  Holiday calendar
                </FieldLabel>
                <NativeSelect
                  id="project-calendar"
                  className="w-full"
                  value={form.holidayCalendarId ?? ""}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      holidayCalendarId: event.target.value || null,
                    })
                  }
                >
                  <option value="">
                    {defaultCalendarName
                      ? `Organization default (${defaultCalendarName})`
                      : "Organization default"}
                  </option>
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </FieldGroup>

          <div className="mt-4 flex justify-end border-t border-border pt-3">
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    await updateProjectCadence({
                      projectId: project.id,
                      capacityUnit: form.capacityUnit,
                      sprintLengthDays: form.sprintLengthDays,
                      defaultHoursPerDay: form.defaultHoursPerDay,
                      workingWeekdays: form.workingWeekdays,
                      timezone: form.timezone,
                      holidayCalendarId: form.holidayCalendarId,
                    });
                    toast.success("Cadence saved.");
                    router.refresh();
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Something went wrong.",
                    );
                  }
                })
              }
            >
              {pending ? <Spinner className="size-4" /> : null}
              Save cadence
            </Button>
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard
            title="What a new sprint gets"
            description="The values above, as the next sprint will be created."
          >
            <dl className="flex flex-col divide-y divide-border text-sm">
              {[
                {
                  term: "Length",
                  detail: `${form.sprintLengthDays} day${form.sprintLengthDays === 1 ? "" : "s"}`,
                },
                {
                  term: "Working week",
                  detail:
                    WEEKDAYS.filter((day) =>
                      form.workingWeekdays.includes(day.value),
                    )
                      .map((day) => day.label)
                      .join(" · ") || "None",
                },
                {
                  term: "Full-day capacity",
                  detail:
                    form.capacityUnit === "points"
                      ? "Story points"
                      : `${form.defaultHoursPerDay}h per person`,
                },
                {
                  term: "Baseline capacity",
                  detail:
                    form.capacityUnit === "points"
                      ? "Set per person"
                      : `${Math.round(form.defaultHoursPerDay * countWorkingDays(form.sprintLengthDays, form.workingWeekdays) * 10) / 10}h per person`,
                },
                { term: "Time zone", detail: form.timezone },
                {
                  term: "Calendar",
                  detail:
                    calendars.find(
                      (calendar) => calendar.id === form.holidayCalendarId,
                    )?.name ??
                    defaultCalendarName ??
                    "Organization default",
                },
              ].map((row) => (
                <div
                  key={row.term}
                  className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <dt className="text-muted-foreground">{row.term}</dt>
                  <dd className="min-w-0 truncate text-right font-semibold tabular-nums">
                    {row.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <SectionCard
            title="Where this applies"
            description="Scope of these settings."
          >
            <p className="text-sm text-muted-foreground">
              Working time is shared across the organization —{" "}
              <Link
                className="text-brand hover:underline"
                href={`${basePath}/sprints`}
              >
                sprints
              </Link>{" "}
              use whichever calendar is selected here, and each person can
              narrow it further from their own availability page.
            </p>
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  );
}

/** Working days inside a sprint of `length` calendar days, counted from a
 * Monday — enough for the baseline figure shown beside the form. */
function countWorkingDays(length: number, weekdays: number[]) {
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    if (weekdays.includes((1 + index) % 7)) count += 1;
  }
  return count;
}
