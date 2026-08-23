"use server";

import { and, asc, desc, eq, gte, lte, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  holiday,
  holidayCalendar,
  member,
  project,
  sprint,
  sprintMemberCapacity,
  user,
  workItem,
} from "@/db/schema";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import {
  recomputeSprintCapacities,
  refreshSprintCommittedPoints,
  refreshSprintPlannedCapacity,
  seedSprintCapacities,
} from "@/lib/capacity-sync";
import {
  bucketEstimates,
  effectiveEstimates,
  sumEstimates,
} from "@/lib/estimate-rollup";
import { scheduleNotifications } from "@/lib/notifications";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import {
  findCallerMembership,
  isUniqueViolation,
  requireProjectPermission,
} from "@/lib/project-access";
import { requireAuth } from "@/lib/session";
import {
  completeSprintSchema,
  createSprintSchema,
  moveSprintSchema,
  projectCadenceSchema,
  sprintIdSchema,
  updateSprintSchema,
} from "@/lib/validation/sprints";

/** Everyone holding an item in the sprint — the bell audience for its events. */
async function sprintAssigneeMemberIds(sprintId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ memberId: workItem.assigneeMemberId })
    .from(workItem)
    .where(eq(workItem.sprintId, sprintId));
  return rows.flatMap((row) => (row.memberId ? [row.memberId] : []));
}

function revalidateSprints() {
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints/[sprintId]", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]", "page");
}

/** Derive the project and org from the stored sprint row — never from input. */
async function loadSprintOrThrow(sprintId: string) {
  const [row] = await db
    .select({
      id: sprint.id,
      organizationId: sprint.organizationId,
      projectId: sprint.projectId,
      name: sprint.name,
      sequence: sprint.sequence,
      state: sprint.state,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      capacityUnit: sprint.capacityUnit,
      plannedCapacity: sprint.plannedCapacity,
      projectKey: project.key,
    })
    .from(sprint)
    .innerJoin(project, eq(sprint.projectId, project.id))
    .where(eq(sprint.id, sprintId))
    .limit(1);
  if (!row) throw new Error("Sprint not found.");
  return row;
}

async function loadProjectOrThrow(projectId: string) {
  const [row] = await db
    .select({
      id: project.id,
      key: project.key,
      organizationId: project.organizationId,
      capacityUnit: project.capacityUnit,
      sprintLengthDays: project.sprintLengthDays,
      defaultHoursPerDay: project.defaultHoursPerDay,
      workingWeekdays: project.workingWeekdays,
      timezone: project.timezone,
      holidayCalendarId: project.holidayCalendarId,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) throw new Error("Project not found.");
  return row;
}

export type SprintSummary = {
  id: string;
  sequence: number;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  state: "planning" | "active" | "completed";
  capacityUnit: "hours" | "points";
  plannedCapacity: number;
  committedPoints: number;
  completedPoints: number;
  memberCount: number;
};

export async function getSprints(input: {
  organizationId: string;
  projectId: string;
}): Promise<SprintSummary[]> {
  await requireProjectPermission(
    input.organizationId,
    input.projectId,
    "sprint:view",
    { project: ["update"] },
    "You don't have permission to view this project's sprints.",
  );

  const rows = await db
    .select({
      id: sprint.id,
      sequence: sprint.sequence,
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      state: sprint.state,
      capacityUnit: sprint.capacityUnit,
      plannedCapacity: sprint.plannedCapacity,
      committedPoints: sprint.committedPoints,
      completedPoints: sprint.completedPoints,
    })
    .from(sprint)
    .where(eq(sprint.projectId, input.projectId))
    .orderBy(desc(sprint.startDate), desc(sprint.sequence));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      sprintId: sprintMemberCapacity.sprintId,
      memberId: sprintMemberCapacity.memberId,
    })
    .from(sprintMemberCapacity)
    .innerJoin(sprint, eq(sprintMemberCapacity.sprintId, sprint.id))
    .where(eq(sprint.projectId, input.projectId));

  const countBySprint = new Map<string, number>();
  for (const row of counts) {
    countBySprint.set(row.sprintId, (countBySprint.get(row.sprintId) ?? 0) + 1);
  }

  // Live sum, not the cached `sprint.committedPoints` column — that column is
  // only frozen at `startSprint`, so it reads 0 for every sprint still in
  // planning even though work items are already assigned to it.
  const items = await db
    .select({
      id: workItem.id,
      // The whole project, and `parentId` with it: an item's estimate can come
      // from children that are scheduled somewhere else entirely.
      parentId: workItem.parentId,
      sprintId: workItem.sprintId,
      points: workItem.points,
    })
    .from(workItem)
    .where(eq(workItem.projectId, input.projectId));

  const estimates = effectiveEstimates(items);
  const scopes = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.sprintId) continue;
    const bucket = scopes.get(item.sprintId);
    if (bucket) bucket.push(item);
    else scopes.set(item.sprintId, [item]);
  }

  return rows.map((row) => ({
    ...row,
    // `sumEstimates`, not a running total: an epic in the sprint already covers
    // the stories under it, so adding both would double the commitment.
    committedPoints: sumEstimates(scopes.get(row.id) ?? [], items, estimates),
    memberCount: countBySprint.get(row.id) ?? 0,
  }));
}

export type SprintCapacityRow = {
  memberId: string;
  name: string;
  email: string;
  image: string | null;
  availabilityPercent: number;
  hoursPerDay: number;
  workingDays: number;
  holidayDays: number;
  leaveDays: number;
  plannedHours: number;
  plannedPoints: number;
  isOverridden: boolean;
  overrideReason: string | null;
  /** Sum of workItem.points for items in this sprint assigned to them. */
  committedPoints: number;
};

export type SprintDetail = SprintSummary & {
  projectId: string;
  organizationId: string;
  projectKey: string;
  timezone: string;
  workingWeekdays: number[];
  startedAt: Date | null;
  closedAt: Date | null;
  capacityLastSyncedAt: Date | null;
  capacities: SprintCapacityRow[];
  /** Non-working days inside the sprint, for the planning view's day strip. */
  holidayDates: { date: string; name: string }[];
};

export async function getSprintDetail(input: {
  organizationId: string;
  sprintId: string;
}): Promise<SprintDetail> {
  const existing = await loadSprintOrThrow(input.sprintId);
  if (existing.organizationId !== input.organizationId) {
    throw new Error("Sprint not found.");
  }
  await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "sprint:view",
    { project: ["update"] },
    "You don't have permission to view this project's sprints.",
  );

  const [[row], capacities, assigned] = await Promise.all([
    db
      .select({
        id: sprint.id,
        sequence: sprint.sequence,
        name: sprint.name,
        goal: sprint.goal,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        state: sprint.state,
        capacityUnit: sprint.capacityUnit,
        plannedCapacity: sprint.plannedCapacity,
        capacityLastSyncedAt: sprint.capacityLastSyncedAt,
        committedPoints: sprint.committedPoints,
        completedPoints: sprint.completedPoints,
        timezone: sprint.timezone,
        workingWeekdays: sprint.workingWeekdays,
        startedAt: sprint.startedAt,
        closedAt: sprint.closedAt,
        projectId: sprint.projectId,
        organizationId: sprint.organizationId,
      })
      .from(sprint)
      .where(eq(sprint.id, input.sprintId))
      .limit(1),
    db
      .select({
        memberId: sprintMemberCapacity.memberId,
        name: user.name,
        email: user.email,
        image: user.image,
        availabilityPercent: sprintMemberCapacity.availabilityPercent,
        hoursPerDay: sprintMemberCapacity.hoursPerDay,
        workingDays: sprintMemberCapacity.workingDays,
        holidayDays: sprintMemberCapacity.holidayDays,
        leaveDays: sprintMemberCapacity.leaveDays,
        plannedHours: sprintMemberCapacity.plannedHours,
        plannedPoints: sprintMemberCapacity.plannedPoints,
        isOverridden: sprintMemberCapacity.isOverridden,
        overrideReason: sprintMemberCapacity.overrideReason,
      })
      .from(sprintMemberCapacity)
      .innerJoin(member, eq(sprintMemberCapacity.memberId, member.id))
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(sprintMemberCapacity.sprintId, input.sprintId))
      .orderBy(asc(user.name)),
    // The whole project, not just this sprint's rows: a parent's estimate is
    // rolled up from children that may be scheduled into another sprint or
    // none, so the sprint's own rows are not enough to size them.
    db
      .select({
        id: workItem.id,
        parentId: workItem.parentId,
        sprintId: workItem.sprintId,
        assigneeMemberId: workItem.assigneeMemberId,
        points: workItem.points,
      })
      .from(workItem)
      .where(eq(workItem.projectId, existing.projectId)),
  ]);

  if (!row) throw new Error("Sprint not found.");

  const holidayDates = await loadSprintHolidays(
    row.projectId,
    row.organizationId,
    row.startDate,
    row.endDate,
  );

  // Committed per person — items with no assignee land in the "" bucket, which
  // nobody's row reads, same as the sprint total counting them while no single
  // person's does. `bucketEstimates` splits the sprint total ONCE rather than
  // re-summing per person: a parent's roll-up already covers its children, so
  // per-person sums would otherwise out-total the sprint whenever a parent and
  // a child are carried by different people.
  const estimates = effectiveEstimates(assigned);
  const inSprint = assigned.filter((item) => item.sprintId === input.sprintId);
  const committedTotal = sumEstimates(inSprint, assigned, estimates);
  const committedByMember = bucketEstimates(
    inSprint,
    (item) => item.assigneeMemberId ?? "",
    assigned,
    estimates,
  );

  return {
    ...row,
    // Live sum of assigned work items, not the cached `sprint.committedPoints`
    // column — that column is only frozen at `startSprint` and stays 0 for
    // the whole planning phase, which is exactly when this number matters most.
    committedPoints: committedTotal,
    projectKey: existing.projectKey,
    memberCount: capacities.length,
    capacities: capacities.map((capacityRow) => ({
      ...capacityRow,
      committedPoints: committedByMember.get(capacityRow.memberId) ?? 0,
    })),
    holidayDates,
  };
}

/** The project's own calendar, falling back to the org default. */
async function loadSprintHolidays(
  projectId: string,
  organizationId: string,
  start: string,
  end: string,
) {
  const projectRow = await loadProjectOrThrow(projectId);
  let calendarId = projectRow.holidayCalendarId;

  if (!calendarId) {
    const [fallback] = await db
      .select({ id: holidayCalendar.id })
      .from(holidayCalendar)
      .where(
        and(
          eq(holidayCalendar.organizationId, organizationId),
          eq(holidayCalendar.isDefault, true),
        ),
      )
      .limit(1);
    calendarId = fallback?.id ?? null;
  }
  if (!calendarId) return [];

  return db
    .select({ date: holiday.date, name: holiday.name })
    .from(holiday)
    .where(
      and(
        eq(holiday.calendarId, calendarId),
        gte(holiday.date, start),
        lte(holiday.date, end),
      ),
    )
    .orderBy(asc(holiday.date));
}

export async function createSprint(input: {
  projectId: string;
  startDate: string;
  endDate: string;
  name?: string;
  goal?: string;
}) {
  const parsed = createSprintSchema.parse(input);
  const projectRow = await loadProjectOrThrow(parsed.projectId);
  const session = await requireProjectPermission(
    projectRow.organizationId,
    parsed.projectId,
    "sprint:create",
    { project: ["update"] },
    "You don't have permission to create sprints in this project.",
  );
  await assertPlatformNotLocked();

  const [{ value: highest }] = await db
    .select({ value: max(sprint.sequence) })
    .from(sprint)
    .where(eq(sprint.projectId, parsed.projectId));
  const sequence = (highest ?? 0) + 1;

  const id = crypto.randomUUID();
  const name = parsed.name?.trim() || `Sprint ${sequence}`;

  try {
    await db.insert(sprint).values({
      id,
      organizationId: projectRow.organizationId,
      projectId: parsed.projectId,
      sequence,
      name,
      goal: parsed.goal || null,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      // Snapshots — later edits to the project's cadence must not rewrite the
      // arithmetic behind a sprint that has already been planned.
      capacityUnit: projectRow.capacityUnit,
      timezone: projectRow.timezone,
      workingWeekdays: projectRow.workingWeekdays,
    });
  } catch (error) {
    // Two concurrent creates can read the same max(sequence); the unique index
    // is the authority, and the name collides the same way.
    if (isUniqueViolation(error)) {
      throw new Error("That sprint name or number is already used. Try again.");
    }
    throw error;
  }

  await recordAudit({
    action: "sprint.created",
    organizationId: projectRow.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: id,
    metadata: {
      projectId: parsed.projectId,
      name,
      sequence,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    },
  });

  scheduleEmbedding({
    organizationId: projectRow.organizationId,
    text: embeddingSource(name, parsed.goal),
    persist: async (result) => {
      await db
        .update(sprint)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(sprint.id, id));
    },
  });

  // Give every current project member a row and compute it, so the planning
  // view is populated the moment the sprint opens.
  await seedSprintCapacities(id);
  revalidateSprints();
  return id;
}

export async function updateSprint(input: {
  sprintId: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
}) {
  const parsed = updateSprintSchema.parse(input);
  const existing = await loadSprintOrThrow(parsed.sprintId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "sprint:manage",
    { project: ["update"] },
    "You don't have permission to change this sprint.",
  );

  if (existing.state === "completed") {
    throw new Error("A completed sprint can't be changed.");
  }

  const datesChanged =
    existing.startDate !== parsed.startDate ||
    existing.endDate !== parsed.endDate;

  try {
    await db
      .update(sprint)
      .set({
        name: parsed.name,
        goal: parsed.goal || null,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      })
      .where(eq(sprint.id, parsed.sprintId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Another sprint in this project already has that name.");
    }
    throw error;
  }

  await recordAudit({
    action: "sprint.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: {
      name: parsed.name,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      datesChanged,
    },
  });

  scheduleEmbedding({
    organizationId: existing.organizationId,
    text: embeddingSource(parsed.name, parsed.goal),
    persist: async (result) => {
      await db
        .update(sprint)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(sprint.id, parsed.sprintId));
    },
  });

  // Different dates mean different working days, holidays and leave overlap.
  if (datesChanged) await recomputeSprintCapacities(parsed.sprintId);
  revalidateSprints();
}

/** Dates only — what the timeline's drag-and-drop calls. */
export async function moveSprint(input: {
  sprintId: string;
  startDate: string;
  endDate: string;
}) {
  const parsed = moveSprintSchema.parse(input);
  const existing = await loadSprintOrThrow(parsed.sprintId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "sprint:manage",
    { project: ["update"] },
    "You don't have permission to reschedule this sprint.",
  );

  if (existing.state === "completed") {
    throw new Error("A completed sprint can't be rescheduled.");
  }
  if (
    existing.startDate === parsed.startDate &&
    existing.endDate === parsed.endDate
  ) {
    return;
  }

  await db
    .update(sprint)
    .set({ startDate: parsed.startDate, endDate: parsed.endDate })
    .where(eq(sprint.id, parsed.sprintId));

  await recordAudit({
    action: "sprint.rescheduled",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: {
      from: { startDate: existing.startDate, endDate: existing.endDate },
      to: { startDate: parsed.startDate, endDate: parsed.endDate },
    },
  });

  await recomputeSprintCapacities(parsed.sprintId);
  revalidateSprints();
}

export async function startSprint(input: { sprintId: string }) {
  const parsed = sprintIdSchema.parse(input);
  const existing = await loadSprintOrThrow(parsed.sprintId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "sprint:manage",
    { project: ["update"] },
    "You don't have permission to start sprints in this project.",
  );

  if (existing.state !== "planning") {
    throw new Error("Only a sprint in planning can be started.");
  }

  // Freeze the plan before flipping state, so plannedCapacity and
  // committedPoints record what the team committed with rather than whatever
  // they drift to later.
  await refreshSprintPlannedCapacity(parsed.sprintId);
  await refreshSprintCommittedPoints(parsed.sprintId);

  try {
    await db
      .update(sprint)
      .set({ state: "active", startedAt: new Date() })
      .where(eq(sprint.id, parsed.sprintId));
  } catch (error) {
    // sprint_projectId_active_uidx — two people can pass the state check above
    // at the same time, and the index is what actually decides.
    if (isUniqueViolation(error)) {
      throw new Error(
        "Another sprint is already active in this project. Complete it first.",
      );
    }
    throw error;
  }

  await recordAudit({
    action: "sprint.started",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: {
      name: existing.name,
      plannedCapacity: existing.plannedCapacity,
      capacityUnit: existing.capacityUnit,
    },
  });
  scheduleNotifications({
    organizationId: existing.organizationId,
    recipientMemberIds: await sprintAssigneeMemberIds(parsed.sprintId),
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: (
        await findCallerMembership(session.user.id, existing.organizationId)
      )?.id,
    },
    action: "sprint.started",
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: { name: existing.name, projectKey: existing.projectKey },
  });
  revalidateSprints();
}

export async function completeSprint(input: {
  sprintId: string;
  completedPoints?: number;
}) {
  const parsed = completeSprintSchema.parse(input);
  const existing = await loadSprintOrThrow(parsed.sprintId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "sprint:manage",
    { project: ["update"] },
    "You don't have permission to complete sprints in this project.",
  );

  if (existing.state === "completed") {
    throw new Error("That sprint is already complete.");
  }

  const callerMembership = await findCallerMembership(
    session.user.id,
    existing.organizationId,
  );

  await db
    .update(sprint)
    .set({
      state: "completed",
      closedAt: new Date(),
      closedByMemberId: callerMembership?.id ?? null,
      ...(parsed.completedPoints === undefined
        ? {}
        : { completedPoints: parsed.completedPoints }),
    })
    .where(eq(sprint.id, parsed.sprintId));

  await recordAudit({
    action: "sprint.completed",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: {
      name: existing.name,
      completedPoints: parsed.completedPoints,
      plannedCapacity: existing.plannedCapacity,
    },
  });
  scheduleNotifications({
    organizationId: existing.organizationId,
    recipientMemberIds: await sprintAssigneeMemberIds(parsed.sprintId),
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: callerMembership?.id,
    },
    action: "sprint.completed",
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: { name: existing.name, projectKey: existing.projectKey },
  });
  revalidateSprints();
}

export async function deleteSprint(input: { sprintId: string }) {
  const parsed = sprintIdSchema.parse(input);
  const existing = await loadSprintOrThrow(parsed.sprintId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "sprint:manage",
    { project: ["update"] },
    "You don't have permission to delete sprints in this project.",
  );

  // Deleting a sprint that ran would erase the record of what the team planned
  // and delivered. Only something never started can go.
  if (existing.state !== "planning") {
    throw new Error(
      "Only a sprint still in planning can be deleted. Complete it instead.",
    );
  }

  await db.delete(sprint).where(eq(sprint.id, parsed.sprintId));

  await recordAudit({
    action: "sprint.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: { name: existing.name, sequence: existing.sequence },
  });
  revalidateSprints();
}

/** The project's sprint cadence — length, working week, unit, calendar. */
export async function updateProjectCadence(input: {
  projectId: string;
  capacityUnit: "hours" | "points";
  sprintLengthDays: number;
  defaultHoursPerDay: number;
  workingWeekdays: number[];
  timezone: string;
  holidayCalendarId?: string | null;
}) {
  const parsed = projectCadenceSchema.parse(input);
  const projectRow = await loadProjectOrThrow(parsed.projectId);
  const session = await requireProjectPermission(
    projectRow.organizationId,
    parsed.projectId,
    "sprint:manage",
    { project: ["update"] },
    "You don't have permission to change this project's cadence.",
  );

  if (parsed.holidayCalendarId) {
    const [calendar] = await db
      .select({ id: holidayCalendar.id })
      .from(holidayCalendar)
      .where(
        and(
          eq(holidayCalendar.id, parsed.holidayCalendarId),
          eq(holidayCalendar.organizationId, projectRow.organizationId),
        ),
      )
      .limit(1);
    if (!calendar) throw new Error("That calendar isn't in this organization.");
  }

  await db
    .update(project)
    .set({
      capacityUnit: parsed.capacityUnit,
      sprintLengthDays: parsed.sprintLengthDays,
      defaultHoursPerDay: parsed.defaultHoursPerDay,
      workingWeekdays: parsed.workingWeekdays,
      timezone: parsed.timezone,
      holidayCalendarId: parsed.holidayCalendarId ?? null,
    })
    .where(eq(project.id, parsed.projectId));

  await recordAudit({
    action: "project.cadence_updated",
    organizationId: projectRow.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: parsed.projectId,
    metadata: {
      capacityUnit: parsed.capacityUnit,
      sprintLengthDays: parsed.sprintLengthDays,
      workingWeekdays: parsed.workingWeekdays,
      timezone: parsed.timezone,
    },
  });

  // Existing sprints keep their snapshots; only the calendar change reaches
  // them, since holidays are resolved live rather than copied.
  const openSprints = await db
    .select({ id: sprint.id })
    .from(sprint)
    .where(
      and(eq(sprint.projectId, parsed.projectId), eq(sprint.state, "planning")),
    );
  for (const row of openSprints) {
    await recomputeSprintCapacities(row.id);
  }

  revalidateSprints();
  revalidatePath("/app/[orgSlug]/[projectKey]/settings", "page");
}

/** Used by the create dialog to prefill sensible dates. */
export async function getNextSprintDefaults(input: {
  organizationId: string;
  projectId: string;
}) {
  await requireAuth();
  const projectRow = await loadProjectOrThrow(input.projectId);
  if (projectRow.organizationId !== input.organizationId) {
    throw new Error("Project not found.");
  }

  const [latest] = await db
    .select({ endDate: sprint.endDate, sequence: sprint.sequence })
    .from(sprint)
    .where(eq(sprint.projectId, input.projectId))
    .orderBy(desc(sprint.endDate))
    .limit(1);

  return {
    lastEndDate: latest?.endDate ?? null,
    nextSequence: (latest?.sequence ?? 0) + 1,
    sprintLengthDays: projectRow.sprintLengthDays,
    capacityUnit: projectRow.capacityUnit,
  };
}
