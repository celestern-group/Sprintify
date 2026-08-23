import "server-only";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  holiday,
  holidayCalendar,
  member,
  memberCapacityProfile,
  memberLeave,
  project,
  projectMember,
  sprint,
  sprintMemberCapacity,
  workItem,
} from "@/db/schema";
import {
  computeMemberCapacity,
  type IsoDate,
  type LeaveWindow,
  plannedPointsFrom,
} from "@/lib/capacity";
import { effectiveEstimates, sumEstimates } from "@/lib/estimate-rollup";

/**
 * Keeps sprintMemberCapacity in step with the things it is derived from —
 * project membership, working patterns, holidays and leave.
 *
 * The rule the whole module turns on: a row with `isOverridden = true` holds a
 * number a human typed, and nothing here may overwrite it. Someone who sets a
 * developer to 30 hours "because they're on support" must not have that erased
 * because a colleague booked a day off.
 *
 * Recomputes are bounded to sprints that are not yet completed and whose dates
 * actually overlap what changed. A finished sprint is history; recalculating it
 * would rewrite the record of what the team planned with.
 */

type SprintRow = {
  id: string;
  projectId: string;
  startDate: string;
  endDate: string;
  workingWeekdays: number[];
  capacityUnit: "hours" | "points";
};

type ProjectRow = {
  id: string;
  defaultHoursPerDay: number;
  holidayCalendarId: string | null;
  organizationId: string;
};

/** Resolution order for whose non-working days apply to a person: their own
 * profile, then the project's, then the organization's default calendar. */
function resolveCalendarId(
  profileCalendarId: string | null | undefined,
  projectCalendarId: string | null,
  orgDefaultCalendarId: string | null,
): string | null {
  return profileCalendarId ?? projectCalendarId ?? orgDefaultCalendarId ?? null;
}

/**
 * A person's own hours-per-day, where they have set one. The project default is
 * only a fallback — someone who works two hours a day says so once on their
 * availability profile rather than on every sprint they are ever added to.
 */
async function loadProfileHoursByMember(
  memberIds: string[],
): Promise<Map<string, number>> {
  if (memberIds.length === 0) return new Map();
  const rows = await db
    .select({
      memberId: memberCapacityProfile.memberId,
      hoursPerDay: memberCapacityProfile.hoursPerDay,
    })
    .from(memberCapacityProfile)
    .where(inArray(memberCapacityProfile.memberId, memberIds));
  return new Map(rows.map((row) => [row.memberId, row.hoursPerDay]));
}

/** The seed value for one person's row: their profile, else the project default. */
export async function resolveMemberHoursPerDay(
  memberId: string,
  fallback: number,
): Promise<number> {
  const byMember = await loadProfileHoursByMember([memberId]);
  return byMember.get(memberId) ?? fallback;
}

async function loadOrgDefaultCalendarId(
  organizationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: holidayCalendar.id })
    .from(holidayCalendar)
    .where(
      and(
        eq(holidayCalendar.organizationId, organizationId),
        eq(holidayCalendar.isDefault, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Holiday dates per calendar, restricted to the window being computed. */
async function loadHolidaysByCalendar(
  calendarIds: string[],
  start: IsoDate,
  end: IsoDate,
): Promise<Map<string, string[]>> {
  const byCalendar = new Map<string, string[]>();
  if (calendarIds.length === 0) return byCalendar;

  const rows = await db
    .select({ calendarId: holiday.calendarId, date: holiday.date })
    .from(holiday)
    .where(
      and(
        inArray(holiday.calendarId, calendarIds),
        gte(holiday.date, start),
        lte(holiday.date, end),
      ),
    );

  for (const row of rows) {
    const list = byCalendar.get(row.calendarId) ?? [];
    list.push(row.date);
    byCalendar.set(row.calendarId, list);
  }
  return byCalendar;
}

/** Leave per member overlapping the window. Cancelled leave is not an absence. */
async function loadLeaveByMember(
  organizationId: string,
  memberIds: string[],
  start: IsoDate,
  end: IsoDate,
): Promise<Map<string, LeaveWindow[]>> {
  const byMember = new Map<string, LeaveWindow[]>();
  if (memberIds.length === 0) return byMember;

  const rows = await db
    .select({
      memberId: memberLeave.memberId,
      startDate: memberLeave.startDate,
      endDate: memberLeave.endDate,
      portion: memberLeave.portion,
    })
    .from(memberLeave)
    .where(
      and(
        eq(memberLeave.organizationId, organizationId),
        inArray(memberLeave.memberId, memberIds),
        ne(memberLeave.status, "cancelled"),
        // Overlap test: starts before the window ends, ends after it starts.
        lte(memberLeave.startDate, end),
        gte(memberLeave.endDate, start),
      ),
    );

  for (const row of rows) {
    const list = byMember.get(row.memberId) ?? [];
    list.push({
      startDate: row.startDate,
      endDate: row.endDate,
      portion: row.portion,
    });
    byMember.set(row.memberId, list);
  }
  return byMember;
}

async function loadSprint(sprintId: string): Promise<{
  sprint: SprintRow;
  project: ProjectRow;
} | null> {
  const [row] = await db
    .select({
      id: sprint.id,
      projectId: sprint.projectId,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      workingWeekdays: sprint.workingWeekdays,
      capacityUnit: sprint.capacityUnit,
      projectDefaultHoursPerDay: project.defaultHoursPerDay,
      projectHolidayCalendarId: project.holidayCalendarId,
      organizationId: project.organizationId,
    })
    .from(sprint)
    .innerJoin(project, eq(sprint.projectId, project.id))
    .where(eq(sprint.id, sprintId))
    .limit(1);

  if (!row) return null;
  return {
    sprint: {
      id: row.id,
      projectId: row.projectId,
      startDate: row.startDate,
      endDate: row.endDate,
      workingWeekdays: row.workingWeekdays,
      capacityUnit: row.capacityUnit,
    },
    project: {
      id: row.projectId,
      defaultHoursPerDay: row.projectDefaultHoursPerDay,
      holidayCalendarId: row.projectHolidayCalendarId,
      organizationId: row.organizationId,
    },
  };
}

/**
 * Creates the missing capacity rows for a sprint's project members, then
 * computes them. Called when a sprint is created and whenever someone joins a
 * project that has sprints in flight — a member with no row is invisible in
 * the capacity table, which reads as "no capacity" rather than "not loaded".
 */
export async function seedSprintCapacities(sprintId: string): Promise<void> {
  const loaded = await loadSprint(sprintId);
  if (!loaded) return;

  const [existing, projectMembers] = await Promise.all([
    db
      .select({ memberId: sprintMemberCapacity.memberId })
      .from(sprintMemberCapacity)
      .where(eq(sprintMemberCapacity.sprintId, sprintId)),
    db
      .select({ memberId: projectMember.memberId })
      .from(projectMember)
      .where(eq(projectMember.projectId, loaded.sprint.projectId)),
  ]);

  const have = new Set(existing.map((row) => row.memberId));
  const missing = projectMembers
    .map((row) => row.memberId)
    .filter((id) => !have.has(id));

  if (missing.length > 0) {
    const profileHours = await loadProfileHoursByMember(missing);
    await db
      .insert(sprintMemberCapacity)
      .values(
        missing.map((memberId) => ({
          sprintId,
          memberId,
          hoursPerDay:
            profileHours.get(memberId) ?? loaded.project.defaultHoursPerDay,
        })),
      )
      .onConflictDoNothing();
  }

  await recomputeSprintCapacities(sprintId);
}

/**
 * Recomputes every non-overridden capacity row on one sprint and refreshes the
 * sprint's cached total.
 *
 * One query per member would be simpler but a project team is small (single
 * digits to low tens), so this loads everything in four queries and writes one
 * update per changed row.
 *
 * `resyncHoursFromProfiles` re-pulls each person's hours-per-day from their
 * availability profile. It is OFF for the incidental recomputes (a colleague
 * books leave, a holiday moves) because the capacity dialog lets someone set a
 * different number for one sprint without pinning the row, and a leave edit
 * elsewhere must not quietly undo that. The explicit "Recalculate" button turns
 * it on — that action means "re-derive this sprint from source".
 */
export async function recomputeSprintCapacities(
  sprintId: string,
  options: { resyncHoursFromProfiles?: boolean } = {},
): Promise<void> {
  const loaded = await loadSprint(sprintId);
  if (!loaded) return;
  const { sprint: sprintRow, project: projectRow } = loaded;

  const rows = await db
    .select({
      id: sprintMemberCapacity.id,
      memberId: sprintMemberCapacity.memberId,
      availabilityPercent: sprintMemberCapacity.availabilityPercent,
      hoursPerDay: sprintMemberCapacity.hoursPerDay,
      hoursPerDayPinned: sprintMemberCapacity.hoursPerDayPinned,
      plannedPoints: sprintMemberCapacity.plannedPoints,
      isOverridden: sprintMemberCapacity.isOverridden,
    })
    .from(sprintMemberCapacity)
    .where(eq(sprintMemberCapacity.sprintId, sprintId));

  if (rows.length === 0) {
    await db
      .update(sprint)
      .set({ plannedCapacity: 0, capacityLastSyncedAt: new Date() })
      .where(eq(sprint.id, sprintId));
    return;
  }

  const memberIds = rows.map((row) => row.memberId);
  const orgDefaultCalendarId = await loadOrgDefaultCalendarId(
    projectRow.organizationId,
  );

  const profiles = await db
    .select({
      memberId: memberCapacityProfile.memberId,
      hoursPerDay: memberCapacityProfile.hoursPerDay,
      workingWeekdays: memberCapacityProfile.workingWeekdays,
      holidayCalendarId: memberCapacityProfile.holidayCalendarId,
    })
    .from(memberCapacityProfile)
    .where(inArray(memberCapacityProfile.memberId, memberIds));
  const profileByMember = new Map(
    profiles.map((profile) => [profile.memberId, profile]),
  );

  const calendarIds = [
    ...new Set(
      memberIds
        .map((memberId) =>
          resolveCalendarId(
            profileByMember.get(memberId)?.holidayCalendarId,
            projectRow.holidayCalendarId,
            orgDefaultCalendarId,
          ),
        )
        .filter((id): id is string => id !== null),
    ),
  ];

  const [holidaysByCalendar, leaveByMember] = await Promise.all([
    loadHolidaysByCalendar(calendarIds, sprintRow.startDate, sprintRow.endDate),
    loadLeaveByMember(
      projectRow.organizationId,
      memberIds,
      sprintRow.startDate,
      sprintRow.endDate,
    ),
  ]);

  for (const row of rows) {
    const profile = profileByMember.get(row.memberId);
    const calendarId = resolveCalendarId(
      profile?.holidayCalendarId,
      projectRow.holidayCalendarId,
      orgDefaultCalendarId,
    );
    // The member's own working week narrows the sprint's, never widens it: a
    // four-day-week contractor doesn't gain a day because the project works
    // five, and a day the project doesn't work is nobody's working day.
    const sprintDays = new Set(sprintRow.workingWeekdays);
    const workingWeekdays = (
      profile?.workingWeekdays ?? sprintRow.workingWeekdays
    ).filter((day) => sprintDays.has(day));

    // A pinned row keeps the hours someone typed on it no matter what; an
    // explicit recalculate re-reads them from the person's profile and drops
    // the per-sprint pin with them — "re-derive from source" means the whole
    // row, not the parts that are convenient.
    // The fallback is the project default, not the row's current number: the
    // row is what recalculate is throwing away, and someone with no profile
    // would otherwise keep a pinned 6 forever.
    const resyncHours = options.resyncHoursFromProfiles && !row.isOverridden;
    const hoursPerDay = resyncHours
      ? (profile?.hoursPerDay ?? projectRow.defaultHoursPerDay)
      : row.hoursPerDay;

    const result = computeMemberCapacity({
      sprintStart: sprintRow.startDate,
      sprintEnd: sprintRow.endDate,
      workingWeekdays,
      holidayDates: calendarId
        ? (holidaysByCalendar.get(calendarId) ?? [])
        : [],
      leaves: leaveByMember.get(row.memberId) ?? [],
      hoursPerDay,
      availabilityPercent: row.availabilityPercent,
    });

    if (row.isOverridden) {
      // Keep the derived context fresh so the table can still show "3 days of
      // leave" beside the overridden number, but leave the number alone.
      await db
        .update(sprintMemberCapacity)
        .set({
          workingDays: result.workingDays,
          holidayDays: result.holidayDays,
          leaveDays: result.leaveDays,
        })
        .where(eq(sprintMemberCapacity.id, row.id));
      continue;
    }

    const plannedPoints = plannedPointsFrom(row.plannedPoints, result);

    await db
      .update(sprintMemberCapacity)
      .set({
        workingDays: result.workingDays,
        holidayDays: result.holidayDays,
        leaveDays: result.leaveDays,
        hoursPerDay,
        ...(resyncHours ? { hoursPerDayPinned: false } : {}),
        plannedHours: result.plannedHours,
        plannedPoints,
      })
      .where(eq(sprintMemberCapacity.id, row.id));
  }

  // Re-summed from the rows rather than accumulated in the loop above, so
  // overridden rows (which the loop skips) still land in the total.
  await refreshSprintPlannedCapacity(sprintId);
  await db
    .update(sprint)
    .set({ capacityLastSyncedAt: new Date() })
    .where(eq(sprint.id, sprintId));
}

/** Re-sums the cached roll-up straight from the rows, so it can never drift
 * from what the capacity table shows. */
export async function refreshSprintPlannedCapacity(
  sprintId: string,
): Promise<void> {
  const [sprintRow] = await db
    .select({ capacityUnit: sprint.capacityUnit })
    .from(sprint)
    .where(eq(sprint.id, sprintId))
    .limit(1);
  if (!sprintRow) return;

  const rows = await db
    .select({
      plannedHours: sprintMemberCapacity.plannedHours,
      plannedPoints: sprintMemberCapacity.plannedPoints,
    })
    .from(sprintMemberCapacity)
    .where(eq(sprintMemberCapacity.sprintId, sprintId));

  const total = rows.reduce(
    (sum, row) =>
      sum +
      (sprintRow.capacityUnit === "points"
        ? row.plannedPoints
        : row.plannedHours),
    0,
  );

  await db
    .update(sprint)
    .set({ plannedCapacity: Math.round(total * 100) / 100 })
    .where(eq(sprint.id, sprintId));
}

/**
 * Re-sums committed from the work items actually scheduled into the sprint,
 * so the number matches the backlog instead of something typed by hand.
 * Unestimated items contribute nothing, same as everywhere else.
 *
 * Reads the whole PROJECT rather than just the sprint's rows, because an
 * item's estimate is not always its own: a parent with no `points` carries the
 * sum of its children, and those children may sit outside this sprint. Summing
 * then drops any row whose ancestor is also in the sprint — otherwise an epic
 * and the stories under it would both be counted and the sprint would read as
 * twice the work (see `sumEstimates`).
 */
export async function refreshSprintCommittedPoints(
  sprintId: string,
): Promise<void> {
  const [sprintRow] = await db
    .select({ projectId: sprint.projectId })
    .from(sprint)
    .where(eq(sprint.id, sprintId))
    .limit(1);
  if (!sprintRow) return;
  await refreshProjectCommittedPoints(sprintRow.projectId);
}

/**
 * Recomputes committed for EVERY sprint in the project, from one read.
 *
 * Deliberately not "just the sprint that changed": with a rolled-up estimate an
 * edit reaches further than the row it touched. Estimating a sub-task moves the
 * story above it, which moves the epic above that — and those ancestors may be
 * scheduled into different sprints, or into none. Naming the affected sprints
 * at each call site would mean walking the parent chain at eight of them and
 * getting it wrong at the ninth; on a delete the chain is gone before anyone
 * could walk it. The whole project is one query, the sums are arithmetic over
 * an array, and only sprints whose number actually moved are written.
 */
export async function refreshProjectCommittedPoints(
  projectId: string,
): Promise<void> {
  const [sprints, rows] = await Promise.all([
    db
      .select({ id: sprint.id, committedPoints: sprint.committedPoints })
      .from(sprint)
      .where(eq(sprint.projectId, projectId)),
    db
      .select({
        id: workItem.id,
        parentId: workItem.parentId,
        points: workItem.points,
        sprintId: workItem.sprintId,
      })
      .from(workItem)
      .where(eq(workItem.projectId, projectId)),
  ]);
  if (sprints.length === 0) return;

  const estimates = effectiveEstimates(rows);
  const scopes = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.sprintId) continue;
    const bucket = scopes.get(row.sprintId);
    if (bucket) bucket.push(row);
    else scopes.set(row.sprintId, [row]);
  }

  await Promise.all(
    sprints.map((sprintRow) => {
      const total = sumEstimates(
        scopes.get(sprintRow.id) ?? [],
        rows,
        estimates,
      );
      if (total === sprintRow.committedPoints) return Promise.resolve();
      return db
        .update(sprint)
        .set({ committedPoints: total })
        .where(eq(sprint.id, sprintRow.id));
    }),
  );
}

/**
 * Pushes a changed availability profile's hours-per-day onto that person's rows
 * in every sprint still in flight.
 *
 * Without this, editing your working pattern changes the days a sprint counts
 * for you but not the hours it multiplies them by — the profile field would
 * look like it did nothing. Completed sprints are history and are left alone.
 * Call this BEFORE the recompute that follows a profile write.
 *
 * An overridden row still holds a deliberate whole-capacity number and is
 * protected. A narrow per-sprint hours pin is different: saving the global
 * availability profile is an explicit source-of-truth update, so it replaces
 * that pin and returns the row to profile-derived capacity.
 */
export async function applyProfileHoursToOpenSprints(
  memberId: string,
): Promise<void> {
  const [profile] = await db
    .select({ hoursPerDay: memberCapacityProfile.hoursPerDay })
    .from(memberCapacityProfile)
    .where(eq(memberCapacityProfile.memberId, memberId))
    .limit(1);
  if (!profile) return;

  const openSprintIds = db
    .select({ id: sprint.id })
    .from(sprint)
    .where(ne(sprint.state, "completed"));

  await db
    .update(sprintMemberCapacity)
    .set({ hoursPerDay: profile.hoursPerDay, hoursPerDayPinned: false })
    .where(
      and(
        eq(sprintMemberCapacity.memberId, memberId),
        eq(sprintMemberCapacity.isOverridden, false),
        inArray(sprintMemberCapacity.sprintId, openSprintIds),
      ),
    );
}

/**
 * Every not-yet-completed sprint in the organization whose dates overlap the
 * changed window. The entry point after a holiday-calendar edit, where the
 * blast radius is "any project that inherits this calendar" — cheaper to
 * recompute the overlapping sprints than to work out which ones resolve to it.
 */
export async function recomputeSprintsInWindow(input: {
  organizationId: string;
  start: IsoDate;
  end: IsoDate;
  /** Restrict to sprints this member is on — used after a leave edit. */
  memberId?: string;
}): Promise<void> {
  const overlapping = and(
    eq(sprint.organizationId, input.organizationId),
    ne(sprint.state, "completed"),
    lte(sprint.startDate, input.end),
    gte(sprint.endDate, input.start),
  );

  const rows = input.memberId
    ? await db
        .selectDistinct({ id: sprint.id })
        .from(sprint)
        .innerJoin(
          sprintMemberCapacity,
          eq(sprintMemberCapacity.sprintId, sprint.id),
        )
        .where(
          and(overlapping, eq(sprintMemberCapacity.memberId, input.memberId)),
        )
    : await db.select({ id: sprint.id }).from(sprint).where(overlapping);

  for (const row of rows) {
    await recomputeSprintCapacities(row.id);
  }
}

/**
 * The capacity rows for a project's in-flight sprints, for use when project
 * membership changes. Adding someone mid-sprint gives them a row; removing
 * them takes it away, so they stop counting toward the total.
 */
export async function syncProjectMemberCapacityRows(input: {
  projectId: string;
  memberId: string;
  action: "add" | "remove";
}): Promise<void> {
  const sprints = await db
    .select({
      id: sprint.id,
      defaultHoursPerDay: project.defaultHoursPerDay,
    })
    .from(sprint)
    .innerJoin(project, eq(sprint.projectId, project.id))
    .where(
      and(eq(sprint.projectId, input.projectId), ne(sprint.state, "completed")),
    );

  const profileHours = await loadProfileHoursByMember([input.memberId]);

  for (const row of sprints) {
    if (input.action === "add") {
      await db
        .insert(sprintMemberCapacity)
        .values({
          sprintId: row.id,
          memberId: input.memberId,
          hoursPerDay:
            profileHours.get(input.memberId) ?? row.defaultHoursPerDay,
        })
        .onConflictDoNothing();
    } else {
      await db
        .delete(sprintMemberCapacity)
        .where(
          and(
            eq(sprintMemberCapacity.sprintId, row.id),
            eq(sprintMemberCapacity.memberId, input.memberId),
          ),
        );
    }
    await recomputeSprintCapacities(row.id);
  }
}

/**
 * Seeds capacity rows across every in-flight sprint of a project. Used after a
 * bulk membership change (expanding a team into a project), where doing it per
 * member would re-walk the same sprints once each.
 */
export async function seedProjectSprintCapacities(
  projectId: string,
): Promise<void> {
  const sprints = await db
    .select({ id: sprint.id })
    .from(sprint)
    .where(and(eq(sprint.projectId, projectId), ne(sprint.state, "completed")));

  for (const row of sprints) {
    await seedSprintCapacities(row.id);
  }
}

/** Members of the organization, for the capacity table and the leave roster. */
export async function loadOrgMemberIds(
  organizationId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.organizationId, organizationId));
  return rows.map((row) => row.id);
}
