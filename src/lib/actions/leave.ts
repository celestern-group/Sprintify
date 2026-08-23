"use server";

import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  holidayCalendar,
  member,
  memberCapacityProfile,
  memberLeave,
  project,
  projectMember,
  projectRole,
  sprint,
  sprintMemberCapacity,
  user,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  applyProfileHoursToOpenSprints,
  recomputeSprintCapacities,
  recomputeSprintsInWindow,
} from "@/lib/capacity-sync";
import { findCallerMembership, hasOrgPermission } from "@/lib/project-access";
import { projectRoleCan } from "@/lib/project-permissions";
import { requireAuth } from "@/lib/session";
import {
  capacityProfileSchema,
  createLeaveSchema,
  leaveIdSchema,
  listLeaveSchema,
  updateLeaveSchema,
} from "@/lib/validation/leave";

function revalidateAvailability() {
  revalidatePath("/app/[orgSlug]/availability", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints/[sprintId]", "page");
}

/**
 * Who may write this member's availability.
 *
 * Everyone owns their own — that is the whole point of the feature, and no
 * permission gates it. Writing someone ELSE's needs either org-level member
 * administration, or `capacity:manage` on a project the two of them share.
 * The project route is what lets a scrum master fix their own squad's numbers
 * without being an org admin.
 */
async function requireAvailabilityAccess(input: {
  organizationId: string;
  targetMemberId?: string;
}) {
  const session = await requireAuth();
  const callerMembership = await findCallerMembership(
    session.user.id,
    input.organizationId,
  );
  if (!callerMembership) {
    throw new Error("You don't have access to this organization.");
  }

  const targetMemberId = input.targetMemberId ?? callerMembership.id;
  if (targetMemberId === callerMembership.id) {
    return { session, callerMembership, targetMemberId, onBehalf: false };
  }

  // Scope-check the target before granting anything: a memberId from the
  // client must be proven to live in this organization.
  const [targetRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.id, targetMemberId),
        eq(member.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!targetRow) {
    throw new Error("That person isn't a member of this organization.");
  }

  if (await hasOrgPermission(input.organizationId, { member: ["update"] })) {
    return { session, callerMembership, targetMemberId, onBehalf: true };
  }

  if (
    await sharesProjectWithCapacityManage(
      callerMembership.id,
      targetMemberId,
      input.organizationId,
    )
  ) {
    return { session, callerMembership, targetMemberId, onBehalf: true };
  }

  throw new Error("You can only change your own availability.");
}

/** True when the caller holds capacity:manage on a project the target is on. */
async function sharesProjectWithCapacityManage(
  callerMemberId: string,
  targetMemberId: string,
  organizationId: string,
): Promise<boolean> {
  // Permissions live in a jsonb array, so the filter happens in JS — the row
  // count here is "projects this one person is on", not a table scan.
  const callerProjects = await db
    .select({
      projectId: projectMember.projectId,
      permissions: projectRole.permissions,
    })
    .from(projectMember)
    .innerJoin(projectRole, eq(projectMember.roleId, projectRole.id))
    .innerJoin(project, eq(projectMember.projectId, project.id))
    .where(
      and(
        eq(projectMember.memberId, callerMemberId),
        eq(project.organizationId, organizationId),
      ),
    );

  const managedProjectIds = callerProjects
    .filter((row) => projectRoleCan(row.permissions, "capacity:manage"))
    .map((row) => row.projectId);
  if (managedProjectIds.length === 0) return false;

  const [shared] = await db
    .select({ id: projectMember.id })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.memberId, targetMemberId),
        inArray(projectMember.projectId, managedProjectIds),
      ),
    )
    .limit(1);
  return shared !== undefined;
}

export type LeaveRow = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  startDate: string;
  endDate: string;
  portion: number;
  type: string;
  status: string;
  note: string | null;
};

export async function listLeave(input: {
  organizationId: string;
  memberId?: string;
  from?: string;
  to?: string;
}): Promise<LeaveRow[]> {
  const parsed = listLeaveSchema.parse(input);
  const session = await requireAuth();
  const membership = await findCallerMembership(
    session.user.id,
    parsed.organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }

  const filters = [eq(memberLeave.organizationId, parsed.organizationId)];
  if (parsed.memberId) filters.push(eq(memberLeave.memberId, parsed.memberId));
  if (parsed.from) filters.push(gte(memberLeave.endDate, parsed.from));
  if (parsed.to) filters.push(lte(memberLeave.startDate, parsed.to));

  const rows = await db
    .select({
      id: memberLeave.id,
      memberId: memberLeave.memberId,
      memberName: user.name,
      memberEmail: user.email,
      startDate: memberLeave.startDate,
      endDate: memberLeave.endDate,
      portion: memberLeave.portion,
      type: memberLeave.type,
      status: memberLeave.status,
      note: memberLeave.note,
    })
    .from(memberLeave)
    .innerJoin(member, eq(memberLeave.memberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(...filters))
    .orderBy(asc(memberLeave.startDate));

  // A note can say why someone is off, which is nobody else's business. Only
  // the person themselves sees it; the roster shows dates and type only.
  return rows.map((row) => ({
    ...row,
    note: row.memberId === membership.id ? row.note : null,
  }));
}

export type CapacityProfile = {
  memberId: string;
  hoursPerDay: number;
  workingWeekdays: number[];
  holidayCalendarId: string | null;
};

export async function getCapacityProfile(input: {
  organizationId: string;
  memberId?: string;
}): Promise<CapacityProfile> {
  const session = await requireAuth();
  const membership = await findCallerMembership(
    session.user.id,
    input.organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }
  const memberId = input.memberId ?? membership.id;

  const [row] = await db
    .select({
      memberId: memberCapacityProfile.memberId,
      hoursPerDay: memberCapacityProfile.hoursPerDay,
      workingWeekdays: memberCapacityProfile.workingWeekdays,
      holidayCalendarId: memberCapacityProfile.holidayCalendarId,
    })
    .from(memberCapacityProfile)
    .where(eq(memberCapacityProfile.memberId, memberId))
    .limit(1);

  // No row means "never customised", not "no working pattern" — hand back the
  // standard week so the form has something to render.
  return (
    row ?? {
      memberId,
      hoursPerDay: 8,
      workingWeekdays: [1, 2, 3, 4, 5],
      holidayCalendarId: null,
    }
  );
}

export async function upsertCapacityProfile(input: {
  organizationId: string;
  memberId?: string;
  hoursPerDay: number;
  workingWeekdays: number[];
  holidayCalendarId?: string | null;
}) {
  const parsed = capacityProfileSchema.parse(input);
  const { session, targetMemberId, onBehalf } = await requireAvailabilityAccess(
    {
      organizationId: parsed.organizationId,
      targetMemberId: parsed.memberId,
    },
  );

  if (parsed.holidayCalendarId) {
    const [calendar] = await db
      .select({ id: holidayCalendar.id })
      .from(holidayCalendar)
      .where(
        and(
          eq(holidayCalendar.id, parsed.holidayCalendarId),
          eq(holidayCalendar.organizationId, parsed.organizationId),
        ),
      )
      .limit(1);
    if (!calendar) throw new Error("That calendar isn't in this organization.");
  }

  await db
    .insert(memberCapacityProfile)
    .values({
      organizationId: parsed.organizationId,
      memberId: targetMemberId,
      hoursPerDay: parsed.hoursPerDay,
      workingWeekdays: parsed.workingWeekdays,
      holidayCalendarId: parsed.holidayCalendarId ?? null,
    })
    .onConflictDoUpdate({
      target: memberCapacityProfile.memberId,
      set: {
        hoursPerDay: parsed.hoursPerDay,
        workingWeekdays: parsed.workingWeekdays,
        holidayCalendarId: parsed.holidayCalendarId ?? null,
        updatedAt: new Date(),
      },
    });

  await recordAudit({
    action: "capacityProfile.updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "member",
    targetId: targetMemberId,
    metadata: {
      hoursPerDay: parsed.hoursPerDay,
      workingWeekdays: parsed.workingWeekdays,
      onBehalf,
    },
  });

  // Hours first, then the recompute that multiplies them by the working days —
  // the other way round and the sprint totals lag one save behind.
  await applyProfileHoursToOpenSprints(targetMemberId);
  await recomputeMemberSprints(targetMemberId);
  revalidateAvailability();
}

export async function createLeave(input: {
  organizationId: string;
  memberId?: string;
  startDate: string;
  endDate: string;
  portion?: 1 | 0.5;
  type?: "vacation" | "sick" | "personal" | "training" | "other";
  status?: "planned" | "confirmed" | "cancelled";
  note?: string;
}) {
  const parsed = createLeaveSchema.parse(input);
  const { session, callerMembership, targetMemberId, onBehalf } =
    await requireAvailabilityAccess({
      organizationId: parsed.organizationId,
      targetMemberId: parsed.memberId,
    });

  await assertNoOverlap({
    organizationId: parsed.organizationId,
    memberId: targetMemberId,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  });

  const id = crypto.randomUUID();
  await db.insert(memberLeave).values({
    id,
    organizationId: parsed.organizationId,
    memberId: targetMemberId,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    portion: parsed.portion,
    type: parsed.type,
    status: parsed.status,
    note: parsed.note || null,
    createdByMemberId: callerMembership.id,
  });

  await recordAudit({
    action: "leave.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "memberLeave",
    targetId: id,
    // Deliberately no `note`: why someone is away is personal, and the audit
    // log is readable by every org admin.
    metadata: {
      memberId: targetMemberId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      type: parsed.type,
      portion: parsed.portion,
      onBehalf,
    },
  });

  await recomputeSprintsInWindow({
    organizationId: parsed.organizationId,
    start: parsed.startDate,
    end: parsed.endDate,
    memberId: targetMemberId,
  });
  revalidateAvailability();
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
  return id;
}

export async function updateLeave(input: {
  leaveId: string;
  startDate: string;
  endDate: string;
  portion: 1 | 0.5;
  type: "vacation" | "sick" | "personal" | "training" | "other";
  status: "planned" | "confirmed" | "cancelled";
  note?: string;
}) {
  const parsed = updateLeaveSchema.parse(input);
  const existing = await loadLeaveOrThrow(parsed.leaveId);
  const { session, targetMemberId, onBehalf } = await requireAvailabilityAccess(
    {
      organizationId: existing.organizationId,
      targetMemberId: existing.memberId,
    },
  );

  await assertNoOverlap({
    organizationId: existing.organizationId,
    memberId: targetMemberId,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    excludeLeaveId: parsed.leaveId,
  });

  await db
    .update(memberLeave)
    .set({
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      portion: parsed.portion,
      type: parsed.type,
      status: parsed.status,
      note: parsed.note || null,
    })
    .where(eq(memberLeave.id, parsed.leaveId));

  await recordAudit({
    action: "leave.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "memberLeave",
    targetId: parsed.leaveId,
    metadata: {
      memberId: targetMemberId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      type: parsed.type,
      status: parsed.status,
      onBehalf,
    },
  });

  // Both windows are recomputed: moving leave off a sprint has to give those
  // days back, not just take them from the new one.
  const start =
    existing.startDate < parsed.startDate
      ? existing.startDate
      : parsed.startDate;
  const end =
    existing.endDate > parsed.endDate ? existing.endDate : parsed.endDate;
  await recomputeSprintsInWindow({
    organizationId: existing.organizationId,
    start,
    end,
    memberId: targetMemberId,
  });
  revalidateAvailability();
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
}

export async function deleteLeave(input: { leaveId: string }) {
  const parsed = leaveIdSchema.parse(input);
  const existing = await loadLeaveOrThrow(parsed.leaveId);
  const { session, targetMemberId, onBehalf } = await requireAvailabilityAccess(
    {
      organizationId: existing.organizationId,
      targetMemberId: existing.memberId,
    },
  );

  await db.delete(memberLeave).where(eq(memberLeave.id, parsed.leaveId));

  await recordAudit({
    action: "leave.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "memberLeave",
    targetId: parsed.leaveId,
    metadata: {
      memberId: targetMemberId,
      startDate: existing.startDate,
      endDate: existing.endDate,
      onBehalf,
    },
  });

  await recomputeSprintsInWindow({
    organizationId: existing.organizationId,
    start: existing.startDate,
    end: existing.endDate,
    memberId: targetMemberId,
  });
  revalidateAvailability();
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
}

async function loadLeaveOrThrow(leaveId: string) {
  const [row] = await db
    .select({
      id: memberLeave.id,
      organizationId: memberLeave.organizationId,
      memberId: memberLeave.memberId,
      startDate: memberLeave.startDate,
      endDate: memberLeave.endDate,
    })
    .from(memberLeave)
    .where(eq(memberLeave.id, leaveId))
    .limit(1);
  if (!row) throw new Error("Leave not found.");
  return row;
}

/**
 * Two overlapping absences for one person is always a mistake — usually a
 * double-submit or an edit that should have replaced the original. The capacity
 * engine already refuses to subtract the same day twice, so this is about
 * keeping the person's own list honest rather than protecting the arithmetic.
 */
async function assertNoOverlap(input: {
  organizationId: string;
  memberId: string;
  startDate: string;
  endDate: string;
  excludeLeaveId?: string;
}) {
  const filters = [
    eq(memberLeave.organizationId, input.organizationId),
    eq(memberLeave.memberId, input.memberId),
    ne(memberLeave.status, "cancelled"),
    lte(memberLeave.startDate, input.endDate),
    gte(memberLeave.endDate, input.startDate),
  ];
  if (input.excludeLeaveId) {
    filters.push(ne(memberLeave.id, input.excludeLeaveId));
  }

  const [clash] = await db
    .select({ id: memberLeave.id })
    .from(memberLeave)
    .where(and(...filters))
    .limit(1);

  if (clash) {
    throw new Error("That overlaps leave you've already booked.");
  }
}

/**
 * Recompute every in-flight sprint the member is on, with no date window —
 * a working-pattern change (hours per day, which weekdays they work) affects
 * all of them, not just the ones overlapping some range. A `member` row belongs
 * to exactly one organization, so the member id alone is a complete scope.
 */
async function recomputeMemberSprints(memberId: string) {
  const rows = await db
    .selectDistinct({ sprintId: sprintMemberCapacity.sprintId })
    .from(sprintMemberCapacity)
    .innerJoin(sprint, eq(sprintMemberCapacity.sprintId, sprint.id))
    .where(
      and(
        eq(sprintMemberCapacity.memberId, memberId),
        ne(sprint.state, "completed"),
      ),
    );

  for (const row of rows) {
    await recomputeSprintCapacities(row.sprintId);
  }
}
