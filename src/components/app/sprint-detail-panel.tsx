"use client";

import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCheck,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconSum,
  IconTargetArrow,
  IconUsers,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CapacityGauge } from "@/components/app/capacity-gauge";
import { PageHeader } from "@/components/app/page-header";
import { SprintStateBadge } from "@/components/app/sprint-state-badge";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { StatCard } from "@/components/dashboard/ui/stat-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { RelativeTime } from "@/components/ui/relative-time";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  recalculateSprintCapacity,
  resetMemberCapacity,
  setMemberCapacity,
} from "@/lib/actions/capacity";
import type { SprintCapacityRow, SprintDetail } from "@/lib/actions/sprints";
import {
  completeSprint,
  startSprint,
  updateSprint,
} from "@/lib/actions/sprints";
import { sprintWorkingDays } from "@/lib/capacity";
import { compareIso, formatIsoShort, todayIso } from "@/lib/date-only";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

type EditRow = {
  memberId: string;
  name: string;
  availabilityPercent: number;
  hoursPerDay: number;
  plannedPoints: number;
};

export function SprintDetailPanel({
  sprint,
  basePath,
  callerMemberId,
  canManageSprint,
  canManageCapacity,
}: {
  sprint: SprintDetail;
  basePath: string;
  callerMemberId: string;
  canManageSprint: boolean;
  canManageCapacity: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editRow, setEditRow] = useState<EditRow | null>(null);
  const [editSprintOpen, setEditSprintOpen] = useState(false);
  const [sprintForm, setSprintForm] = useState({
    name: sprint.name,
    goal: sprint.goal ?? "",
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  });

  const isPoints = sprint.capacityUnit === "points";
  const unitLabel = isPoints ? "pts" : "h";
  const locked = sprint.state === "completed";

  const capacity = sprint.plannedCapacity;
  const committed = sprint.committedPoints;
  const remaining = Math.round((capacity - committed) * 100) / 100;
  const over = committed > capacity && capacity > 0;

  const today = todayIso();
  // Working days left counts from today, or from the start if it hasn't begun.
  const daysLeft =
    compareIso(today, sprint.endDate) > 0
      ? 0
      : sprintWorkingDays(
          compareIso(today, sprint.startDate) > 0 ? today : sprint.startDate,
          sprint.endDate,
          sprint.workingWeekdays,
        );

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

  function canEditRow(row: SprintCapacityRow) {
    if (locked) return false;
    return canManageCapacity || row.memberId === callerMemberId;
  }

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow={`${sprint.projectKey} · Sprint ${sprint.sequence}`}
        title={sprint.name}
        description={sprint.goal ?? "No goal set for this sprint."}
        backHref={`${basePath}/sprints`}
        backLabel="All sprints"
      >
        <SprintStateBadge state={sprint.state} />
        {canManageSprint && !locked ? (
          <>
            <Button variant="outline" onClick={() => setEditSprintOpen(true)}>
              <IconPencil className="size-4" />
              Edit
            </Button>
            {sprint.state === "planning" ? (
              <Button
                disabled={pending}
                onClick={() =>
                  run(
                    () => startSprint({ sprintId: sprint.id }),
                    "Sprint started.",
                  )
                }
              >
                <IconPlayerPlay className="size-4" />
                Start sprint
              </Button>
            ) : (
              <ConfirmDialog
                title={`Complete ${sprint.name}?`}
                description="The sprint becomes read-only. Its capacity numbers are kept as the record of what was planned."
                confirmLabel="Complete"
                onConfirm={() => completeSprint({ sprintId: sprint.id })}
                trigger={
                  <Button>
                    <IconCheck className="size-4" />
                    Complete sprint
                  </Button>
                }
              />
            )}
          </>
        ) : null}
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Capacity"
          value={`${capacity}${unitLabel}`}
          icon={IconSum}
          foot={`${sprint.memberCount} member${sprint.memberCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Committed"
          value={`${committed}${unitLabel}`}
          icon={IconTargetArrow}
          tone="blue"
          foot={isPoints ? "Story points" : "Planned work"}
        />
        <StatCard
          label="Remaining"
          value={`${remaining}${unitLabel}`}
          icon={IconUsers}
          tone={over ? "amber" : "success"}
          foot={over ? "Over capacity" : "Headroom"}
        />
        <StatCard
          label="Working days left"
          value={daysLeft}
          icon={IconCalendarEvent}
          tone="amber"
          foot={`${formatIsoShort(sprint.startDate)} – ${formatIsoShort(sprint.endDate)}`}
        />
      </div>

      {over ? (
        // Colour is never the only signal — this states the problem in words.
        <Alert variant="destructive">
          <IconAlertTriangle className="size-4" />
          <AlertTitle>Committed beyond capacity</AlertTitle>
          <AlertDescription>
            The team has committed {committed}
            {unitLabel} against {capacity}
            {unitLabel} of capacity —{" "}
            {Math.round((committed - capacity) * 100) / 100}
            {unitLabel} more than there is time for. Reduce the commitment, or
            raise capacity if someone&apos;s availability is out of date.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <SectionCard
          title="Capacity by person"
          description={
            <span>
              Derived from each person&apos;s working pattern and hours per day,
              the holiday calendar and their booked time off.{" "}
              {sprint.capacityLastSyncedAt ? (
                <>
                  Last synced{" "}
                  <RelativeTime
                    date={sprint.capacityLastSyncedAt}
                    titlePrefix="Capacity last synced"
                  />
                  .
                </>
              ) : (
                "Not synced yet."
              )}
            </span>
          }
          action={
            canManageCapacity && !locked ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => recalculateSprintCapacity({ sprintId: sprint.id }),
                    "Capacity recalculated.",
                  )
                }
              >
                <IconRefresh className="size-4" />
                Recalculate
              </Button>
            ) : null
          }
          bodyClassName="overflow-x-auto"
        >
          {sprint.capacities.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="grid size-11 place-items-center rounded-md bg-chip text-brand">
                <IconUsers className="size-5" />
              </div>
              <p className="text-sm font-semibold">
                Nobody is on this project yet
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add members to the project and their capacity rows appear here
                automatically.
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-bold">
                    Person
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    Days
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    Holidays
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    Leave
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    Available
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    {isPoints ? "Points" : "Hours"}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    Committed
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sprint.capacities.map((row) => {
                  const planned = isPoints
                    ? row.plannedPoints
                    : row.plannedHours;
                  const share =
                    capacity > 0 ? Math.min(1, planned / capacity) : 0;
                  const rowOver = row.committedPoints > planned && planned > 0;
                  return (
                    <tr key={row.memberId}>
                      <th
                        scope="row"
                        className="max-w-[14rem] py-2.5 pr-3 text-left font-medium"
                      >
                        <span className="block truncate">{row.name}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {row.memberId === callerMemberId ? "You" : row.email}
                        </span>
                      </th>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {row.workingDays}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {row.holidayDays || "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {row.leaveDays || "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {row.availabilityPercent}%
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <span className="flex flex-col items-end gap-1">
                          <span className="font-semibold tabular-nums">
                            {planned}
                            {unitLabel}
                            {row.isOverridden ? (
                              <span
                                className="ml-1 text-[10px] font-bold uppercase tracking-[0.09em] text-warning"
                                title={row.overrideReason ?? "Manually set"}
                              >
                                Set
                              </span>
                            ) : null}
                          </span>
                          <span
                            aria-hidden
                            className="h-1 w-20 overflow-hidden rounded-full bg-muted"
                          >
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${share * 100}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        <span
                          className={
                            rowOver ? "font-semibold text-destructive" : ""
                          }
                        >
                          {row.committedPoints}
                          {unitLabel}
                        </span>
                        {rowOver ? (
                          <span className="block text-[10px] font-bold uppercase tracking-[0.09em] text-destructive">
                            Over
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="flex items-center justify-end gap-1">
                          {canEditRow(row) ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit capacity for ${row.name}`}
                              onClick={() =>
                                setEditRow({
                                  memberId: row.memberId,
                                  name: row.name,
                                  availabilityPercent: row.availabilityPercent,
                                  hoursPerDay: row.hoursPerDay,
                                  plannedPoints: row.plannedPoints,
                                })
                              }
                            >
                              <IconPencil className="size-4" />
                            </Button>
                          ) : null}
                          {canEditRow(row) && row.isOverridden ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Reset ${row.name} to the calculated value`}
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () =>
                                    resetMemberCapacity({
                                      sprintId: sprint.id,
                                      memberId: row.memberId,
                                    }),
                                  "Reset to the calculated value.",
                                )
                              }
                            >
                              <IconRefresh className="size-4" />
                            </Button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard title="Commitment" description="Against total capacity.">
            <CapacityGauge
              committed={committed}
              capacity={capacity}
              unitLabel={unitLabel}
            />
          </SectionCard>

          <SectionCard
            title="Non-working days"
            description="From the calendar this project uses."
          >
            {sprint.holidayDates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None inside this sprint.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {sprint.holidayDates.map((row) => (
                  <li key={row.date} className="flex justify-between gap-3">
                    <span className="truncate">{row.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatIsoShort(row.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Per-person capacity edit */}
      <Dialog
        open={editRow !== null}
        onOpenChange={(next) => {
          if (!next) setEditRow(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capacity — {editRow?.name}</DialogTitle>
            <DialogDescription>
              Availability scales what is left after holidays and time off. Book
              actual absences as time off rather than lowering this. Hours per
              day here applies to this sprint only — change it on the
              availability profile to make it stick.
            </DialogDescription>
          </DialogHeader>
          {editRow ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="availability">Availability (%)</FieldLabel>
                <Input
                  id="availability"
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  className="w-32 tabular-nums"
                  value={editRow.availabilityPercent}
                  onChange={(event) =>
                    setEditRow({
                      ...editRow,
                      availabilityPercent: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="hours-day">Hours per day</FieldLabel>
                <Input
                  id="hours-day"
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  className="w-32 tabular-nums"
                  value={editRow.hoursPerDay}
                  onChange={(event) =>
                    setEditRow({
                      ...editRow,
                      hoursPerDay: Number(event.target.value),
                    })
                  }
                />
              </Field>
              {isPoints ? (
                <Field>
                  <FieldLabel htmlFor="baseline-points">
                    Full-sprint points
                  </FieldLabel>
                  <Input
                    id="baseline-points"
                    type="number"
                    min={0}
                    step={1}
                    className="w-32 tabular-nums"
                    value={editRow.plannedPoints}
                    onChange={(event) =>
                      setEditRow({
                        ...editRow,
                        plannedPoints: Number(event.target.value),
                      })
                    }
                  />
                </Field>
              ) : null}
            </FieldGroup>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if (!editRow) return;
                run(async () => {
                  await setMemberCapacity({
                    sprintId: sprint.id,
                    memberId: editRow.memberId,
                    availabilityPercent: editRow.availabilityPercent,
                    hoursPerDay: editRow.hoursPerDay,
                    plannedPoints: isPoints ? editRow.plannedPoints : undefined,
                    isOverridden: false,
                  });
                  setEditRow(null);
                }, "Capacity updated.");
              }}
            >
              {pending ? <Spinner className="size-4" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sprint edit — also the keyboard-accessible way to reschedule, since
          the timeline's drag is mouse-only. */}
      <Dialog open={editSprintOpen} onOpenChange={setEditSprintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit sprint</DialogTitle>
            <DialogDescription>
              Changing the dates recalculates everyone&apos;s capacity, except
              rows someone has set by hand.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-name">Name</FieldLabel>
              <Input
                id="edit-name"
                value={sprintForm.name}
                onChange={(event) =>
                  setSprintForm({ ...sprintForm, name: event.target.value })
                }
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="edit-start">Starts</FieldLabel>
                <Input
                  id="edit-start"
                  type="date"
                  className="tabular-nums"
                  value={sprintForm.startDate}
                  onChange={(event) =>
                    setSprintForm({
                      ...sprintForm,
                      startDate: event.target.value,
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-end">Ends</FieldLabel>
                <Input
                  id="edit-end"
                  type="date"
                  className="tabular-nums"
                  min={sprintForm.startDate}
                  value={sprintForm.endDate}
                  onChange={(event) =>
                    setSprintForm({
                      ...sprintForm,
                      endDate: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="edit-goal">Goal</FieldLabel>
              <Textarea
                id="edit-goal"
                rows={2}
                value={sprintForm.goal}
                onChange={(event) =>
                  setSprintForm({ ...sprintForm, goal: event.target.value })
                }
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSprintOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !sprintForm.name.trim()}
              onClick={() =>
                run(async () => {
                  await updateSprint({
                    sprintId: sprint.id,
                    name: sprintForm.name,
                    goal: sprintForm.goal,
                    startDate: sprintForm.startDate,
                    endDate: sprintForm.endDate,
                  });
                  setEditSprintOpen(false);
                }, "Sprint updated.")
              }
            >
              {pending ? <Spinner className="size-4" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
