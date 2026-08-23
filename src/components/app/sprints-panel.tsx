"use client";

import {
  IconArrowRight,
  IconCalendarStats,
  IconChecks,
  IconPlayerPlay,
  IconPlus,
  IconSum,
  IconTargetArrow,
  IconTrash,
} from "@tabler/icons-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PageHeader } from "@/components/app/page-header";
import { SprintStateBadge } from "@/components/app/sprint-state-badge";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { StatCard } from "@/components/dashboard/ui/stat-card";
import { AvatarStack } from "@/components/kibo-ui/avatar-stack";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { PreferenceScopeProvider } from "@/components/preferences/preference-scope";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { SprintSummary } from "@/lib/actions/sprints";
import { createSprint, deleteSprint, startSprint } from "@/lib/actions/sprints";
import { sprintEndFrom } from "@/lib/capacity";
import {
  addDaysIso,
  daysBetweenIso,
  formatIsoShort,
  todayIso,
} from "@/lib/date-only";

// The timeline pulls in dnd-kit, jotai and friends. Loading it lazily keeps
// that weight off every other route — and it is "use client" only anyway.
const SprintTimeline = dynamic(
  () =>
    import("@/components/app/sprint-timeline").then(
      (mod) => mod.SprintTimeline,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[22rem] animate-pulse rounded-lg border border-border bg-muted"
        aria-hidden
      />
    ),
  },
);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function SprintsPanel(
  props: React.ComponentProps<typeof SprintsPanelBody>,
) {
  // The timeline's zoom is remembered per project, same as the backlog's views:
  // a two-week cadence and a quarterly roadmap are read at different scales.
  return (
    <PreferenceScopeProvider scope={`project:${props.project.id}`}>
      <SprintsPanelBody {...props} />
    </PreferenceScopeProvider>
  );
}

function SprintsPanelBody({
  project,
  basePath,
  sprints,
  holidays,
  memberNames,
  canCreate,
  canManage,
  defaults,
}: {
  project: {
    id: string;
    name: string;
    key: string;
    capacityUnit: "hours" | "points";
  };
  basePath: string;
  sprints: SprintSummary[];
  holidays: { date: string; name: string }[];
  memberNames: string[];
  canCreate: boolean;
  canManage: boolean;
  defaults: {
    lastEndDate: string | null;
    nextSequence: number;
    sprintLengthDays: number;
  };
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function seedForm() {
    const start = defaults.lastEndDate
      ? addDaysIso(defaults.lastEndDate, 1)
      : todayIso();
    return {
      name: `Sprint ${defaults.nextSequence}`,
      goal: "",
      startDate: start,
      endDate: sprintEndFrom(start, defaults.sprintLengthDays),
    };
  }

  const [form, setForm] = useState(seedForm);

  // Seeded from `defaults`, which move every time a sprint is created — so the
  // draft is rebuilt when the dialog opens rather than kept from mount, or the
  // second sprint would be proposed with the first one's name and dates.
  function openCreate() {
    setForm(seedForm());
    setCreateOpen(true);
  }

  const active = sprints.filter((row) => row.state === "active");
  const planning = sprints.filter((row) => row.state === "planning");
  const completed = sprints.filter((row) => row.state === "completed");

  // The KPI row reads the sprint in flight; with none running it falls back to
  // the next one in planning so the numbers are never all dashes.
  const focus = active[0] ?? planning[0] ?? null;
  const focusOver = focus
    ? focus.committedPoints > focus.plannedCapacity
    : false;

  function run(work: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  const unitLabel = project.capacityUnit === "points" ? "pts" : "h";

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow={project.key}
        title="Sprints"
        description="When each sprint runs, and how much the team can take on."
      >
        {canCreate ? (
          <Button onClick={openCreate}>
            <IconPlus className="size-4" />
            New sprint
          </Button>
        ) : null}
      </PageHeader>
      {sprints.length === 0 ? (
        <SectionCard title="No sprints yet" description="Plan the first one.">
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="grid size-11 place-items-center rounded-md bg-chip text-brand">
              <IconCalendarStats className="size-5" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              A sprint sets the dates. Everyone on the project gets a capacity
              row automatically, calculated from their working pattern, the
              holiday calendar and any booked time off.
            </p>
            {canCreate ? (
              <Button onClick={openCreate}>
                <IconPlus className="size-4" />
                Plan the first sprint
              </Button>
            ) : null}
          </div>
        </SectionCard>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={active.length > 0 ? "Sprint in flight" : "Next up"}
              value={focus ? `${focus.plannedCapacity}${unitLabel}` : "—"}
              icon={IconSum}
              foot={focus ? `${focus.name} · capacity` : "Nothing scheduled"}
            />
            <StatCard
              label="Committed"
              value={focus ? `${focus.committedPoints}${unitLabel}` : "—"}
              icon={IconTargetArrow}
              tone={focusOver ? "amber" : "blue"}
              foot={
                focus
                  ? focusOver
                    ? "Over capacity"
                    : `${Math.round((focus.plannedCapacity - focus.committedPoints) * 100) / 100}${unitLabel} headroom`
                  : "No sprint to commit to"
              }
            />
            <StatCard
              label="In planning"
              value={planning.length}
              icon={IconCalendarStats}
              tone="brand"
              foot={
                planning[0]
                  ? `Next starts ${formatIsoShort(planning[0].startDate)}`
                  : "Nothing queued"
              }
            />
            <StatCard
              label="Completed"
              value={completed.length}
              icon={IconChecks}
              tone="success"
              foot={`${sprints.length} sprint${sprints.length === 1 ? "" : "s"} all time`}
            />
          </div>

          <SprintTimeline
            sprints={sprints}
            holidays={holidays}
            basePath={basePath}
            canReschedule={canManage}
          />

          {[
            { title: "Active", rows: active },
            { title: "Planning", rows: planning },
            { title: "Completed", rows: completed },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <SectionCard
                key={group.title}
                title={group.title}
                description={`${group.rows.length} sprint${group.rows.length === 1 ? "" : "s"}`}
                bodyClassName="overflow-x-auto"
              >
                {/* A table, not a stack of rows: the wide canvas gives every
                    number its own column so sprints compare down the page. */}
                <table className="w-full min-w-[52rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-bold">
                        Sprint
                      </th>
                      <th scope="col" className="py-2 pr-3 font-bold">
                        Dates
                      </th>
                      <th
                        scope="col"
                        className="py-2 pr-3 text-right font-bold"
                      >
                        Days
                      </th>
                      <th scope="col" className="py-2 pr-3 font-bold">
                        Team
                      </th>
                      <th
                        scope="col"
                        className="py-2 pr-3 text-right font-bold"
                      >
                        Capacity
                      </th>
                      <th
                        scope="col"
                        className="py-2 pr-3 text-right font-bold"
                      >
                        Committed
                      </th>
                      <th scope="col" className="py-2 text-right font-bold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.rows.map((row) => {
                      const share =
                        row.plannedCapacity > 0
                          ? Math.min(
                              1,
                              row.committedPoints / row.plannedCapacity,
                            )
                          : 0;
                      const over = row.committedPoints > row.plannedCapacity;
                      return (
                        <tr key={row.id}>
                          <th
                            scope="row"
                            className="max-w-[20rem] py-2.5 pr-3 text-left font-medium"
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`${basePath}/sprints/${row.id}`}
                                className="truncate font-semibold hover:underline"
                              >
                                {row.name}
                              </Link>
                              <SprintStateBadge state={row.state} />
                            </span>
                            {row.goal ? (
                              <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                                {row.goal}
                              </span>
                            ) : null}
                          </th>
                          <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                            {formatIsoShort(row.startDate)} –{" "}
                            {formatIsoShort(row.endDate)}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                            {daysBetweenIso(row.startDate, row.endDate)}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="flex items-center gap-2">
                              {memberNames.length > 0 ? (
                                <AvatarStack className="hidden xl:flex">
                                  {memberNames.slice(0, 4).map((name) => (
                                    <Avatar key={name} className="size-6">
                                      <AvatarFallback className="text-[10px]">
                                        {initials(name)}
                                      </AvatarFallback>
                                    </Avatar>
                                  ))}
                                </AvatarStack>
                              ) : null}
                              <span className="tabular-nums text-muted-foreground">
                                {row.memberCount}
                              </span>
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                            {row.plannedCapacity}
                            {unitLabel}
                          </td>
                          <td className="py-2.5 pr-3 text-right">
                            <span className="flex flex-col items-end gap-1">
                              <span
                                className={
                                  over
                                    ? "font-semibold tabular-nums text-warning"
                                    : "font-semibold tabular-nums"
                                }
                              >
                                {row.committedPoints}
                                {unitLabel}
                                {over ? (
                                  <span className="ml-1 text-[10px] font-bold uppercase tracking-[0.09em] text-warning">
                                    Over
                                  </span>
                                ) : null}
                              </span>
                              <span
                                aria-hidden
                                className="h-1 w-24 overflow-hidden rounded-full bg-muted"
                              >
                                <span
                                  className={
                                    over
                                      ? "block h-full rounded-full bg-warning"
                                      : "block h-full rounded-full bg-primary"
                                  }
                                  style={{ width: `${share * 100}%` }}
                                />
                              </span>
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="flex items-center justify-end gap-1">
                              {canManage && row.state === "planning" ? (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={pending}
                                    onClick={() =>
                                      run(
                                        () => startSprint({ sprintId: row.id }),
                                        `${row.name} started.`,
                                      )
                                    }
                                  >
                                    <IconPlayerPlay className="size-4" />
                                    Start
                                  </Button>
                                  <ConfirmDialog
                                    title={`Delete ${row.name}?`}
                                    description="Only a sprint that never started can be deleted. Its capacity rows go with it."
                                    confirmLabel="Delete"
                                    variant="destructive"
                                    onConfirm={() =>
                                      run(
                                        () =>
                                          deleteSprint({ sprintId: row.id }),
                                        "Sprint deleted.",
                                      )
                                    }
                                    trigger={
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Delete ${row.name}`}
                                      >
                                        <IconTrash className="size-4" />
                                      </Button>
                                    }
                                  />
                                </>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon"
                                nativeButton={false}
                                render={
                                  <Link
                                    href={`${basePath}/sprints/${row.id}`}
                                    aria-label={`Open ${row.name}`}
                                  />
                                }
                              >
                                <IconArrowRight className="size-4" />
                              </Button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SectionCard>
            ))}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New sprint</DialogTitle>
            <DialogDescription>
              Dates are prefilled from the project&apos;s cadence and the last
              sprint&apos;s end. Everyone on the project gets a capacity row.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sprint-name">Name</FieldLabel>
              <Input
                id="sprint-name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sprint-start">Starts</FieldLabel>
                <Input
                  id="sprint-start"
                  type="date"
                  className="tabular-nums"
                  value={form.startDate}
                  onChange={(event) => {
                    const startDate = event.target.value;
                    setForm({
                      ...form,
                      startDate,
                      // Keep the configured length when the start moves, so the
                      // common case needs one field, not two.
                      endDate: startDate
                        ? sprintEndFrom(startDate, defaults.sprintLengthDays)
                        : form.endDate,
                    });
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sprint-end">Ends</FieldLabel>
                <Input
                  id="sprint-end"
                  type="date"
                  className="tabular-nums"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(event) =>
                    setForm({ ...form, endDate: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="sprint-goal">Goal (optional)</FieldLabel>
              <Textarea
                id="sprint-goal"
                rows={2}
                value={form.goal}
                onChange={(event) =>
                  setForm({ ...form, goal: event.target.value })
                }
                placeholder="What this sprint is for."
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !form.name.trim() || !form.startDate}
              onClick={() =>
                run(async () => {
                  await createSprint({
                    projectId: project.id,
                    name: form.name,
                    goal: form.goal,
                    startDate: form.startDate,
                    endDate: form.endDate,
                  });
                  setCreateOpen(false);
                }, "Sprint created.")
              }
            >
              {pending ? <Spinner className="size-4" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
