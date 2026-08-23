"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { project, sprint, sprintMemberCapacity } from "@/db/schema";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import {
  recomputeSprintCapacities,
  refreshSprintPlannedCapacity,
  resolveMemberHoursPerDay,
} from "@/lib/capacity-sync";
import {
  findCallerMembership,
  hasOrgPermission,
  loadCallerProjectPermissions,
} from "@/lib/project-access";
import { projectRoleCan } from "@/lib/project-permissions";
import { requireAuth } from "@/lib/session";
import {
  resetMemberCapacitySchema,
  setMemberCapacitySchema,
} from "@/lib/validation/sprints";

function revalidateSprint() {
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints/[sprintId]", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
}

async function loadSprintOrThrow(sprintId: string) {
  const [row] = await db
    .select({
      id: sprint.id,
      organizationId: sprint.organizationId,
      projectId: sprint.projectId,
      name: sprint.name,
      state: sprint.state,
      capacityUnit: sprint.capacityUnit,
      defaultHoursPerDay: project.defaultHoursPerDay,
    })
    .from(sprint)
    .innerJoin(project, eq(sprint.projectId, project.id))
    .where(eq(sprint.id, sprintId))
    .limit(1);
  if (!row) throw new Error("Sprint not found.");
  return row;
}

/**
 * Who may write this row.
 *
 * Editing your OWN capacity needs no permission — the whole point is that
 * every member keeps their own number current. Editing someone else's needs
 * `capacity:manage` on the project (or org owner/admin rights, the same bypass
 * every other project check honours).
 */
async function requireCapacityAccess(sprintId: string, targetMemberId: string) {
  const session = await requireAuth();
  const sprintRow = await loadSprintOrThrow(sprintId);

  if (sprintRow.state === "completed") {
    throw new Error("A completed sprint's capacity can't be changed.");
  }

  const membership = await findCallerMembership(
    session.user.id,
    sprintRow.organizationId,
  );
  if (!membership) throw new Error("Sprint not found.");

  // The row must belong to this sprint before anything else is decided.
  const [row] = await db
    .select({ id: sprintMemberCapacity.id })
    .from(sprintMemberCapacity)
    .where(
      and(
        eq(sprintMemberCapacity.sprintId, sprintId),
        eq(sprintMemberCapacity.memberId, targetMemberId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("That person isn't on this sprint.");

  const isSelf = membership.id === targetMemberId;
  if (isSelf) return { session, sprintRow, membership, isSelf };

  if (
    await hasOrgPermission(sprintRow.organizationId, { project: ["update"] })
  ) {
    return { session, sprintRow, membership, isSelf };
  }

  const permissions = await loadCallerProjectPermissions(
    sprintRow.organizationId,
    sprintRow.projectId,
    session.user.id,
  );
  if (!projectRoleCan(permissions, "capacity:manage")) {
    throw new Error("You can only change your own capacity on this sprint.");
  }

  return { session, sprintRow, membership, isSelf };
}

export async function setMemberCapacity(input: {
  sprintId: string;
  memberId: string;
  availabilityPercent: number;
  hoursPerDay: number;
  plannedPoints?: number;
  isOverridden?: boolean;
  overrideReason?: string;
  plannedHours?: number;
}) {
  const parsed = setMemberCapacitySchema.parse(input);
  const { session, sprintRow, membership, isSelf } =
    await requireCapacityAccess(parsed.sprintId, parsed.memberId);

  // The embedding trio is cleared on every write and only re-populated below
  // when there is still a reason to embed — that way a vector can never
  // outlive the text it was built from, whether the reason changed or was
  // dropped entirely.
  const overrideReason = parsed.isOverridden
    ? parsed.overrideReason || null
    : null;

  if (parsed.isOverridden) {
    // A pinned row stores exactly what was typed and is skipped by every
    // later recompute, so the derived columns are written here and then left
    // alone until someone resets it.
    await db
      .update(sprintMemberCapacity)
      .set({
        availabilityPercent: parsed.availabilityPercent,
        hoursPerDay: parsed.hoursPerDay,
        plannedHours: parsed.plannedHours ?? 0,
        plannedPoints: parsed.plannedPoints ?? 0,
        // An override already holds every number on the row; the narrower pin
        // would be a second flag saying the same thing, so it is cleared.
        hoursPerDayPinned: false,
        isOverridden: true,
        overrideReason,
        embedding: null,
        embeddingModel: null,
        embeddingUpdatedAt: null,
        updatedByMemberId: membership.id,
      })
      .where(
        and(
          eq(sprintMemberCapacity.sprintId, parsed.sprintId),
          eq(sprintMemberCapacity.memberId, parsed.memberId),
        ),
      );
    await refreshSprintPlannedCapacity(parsed.sprintId);
  } else {
    // The dialog tells people these hours apply to this sprint only, so a
    // number that differs from what the row would inherit is pinned and later
    // profile saves step around it. Typing the inherited number back is not an
    // edit — it leaves the row following the profile.
    const inheritedHoursPerDay = await resolveMemberHoursPerDay(
      parsed.memberId,
      sprintRow.defaultHoursPerDay,
    );
    await db
      .update(sprintMemberCapacity)
      .set({
        availabilityPercent: parsed.availabilityPercent,
        hoursPerDay: parsed.hoursPerDay,
        hoursPerDayPinned: parsed.hoursPerDay !== inheritedHoursPerDay,
        // In points mode this is the full-sprint baseline the engine prorates.
        ...(parsed.plannedPoints === undefined
          ? {}
          : { plannedPoints: parsed.plannedPoints }),
        isOverridden: false,
        overrideReason: null,
        embedding: null,
        embeddingModel: null,
        embeddingUpdatedAt: null,
        updatedByMemberId: membership.id,
      })
      .where(
        and(
          eq(sprintMemberCapacity.sprintId, parsed.sprintId),
          eq(sprintMemberCapacity.memberId, parsed.memberId),
        ),
      );
    // Re-derive from the working pattern, holidays and leave.
    await recomputeSprintCapacities(parsed.sprintId);
  }

  await recordAudit({
    action: "capacity.updated",
    organizationId: sprintRow.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: {
      memberId: parsed.memberId,
      availabilityPercent: parsed.availabilityPercent,
      hoursPerDay: parsed.hoursPerDay,
      isOverridden: parsed.isOverridden,
      onBehalf: !isSelf,
    },
  });
  if (overrideReason) {
    scheduleEmbedding({
      organizationId: sprintRow.organizationId,
      text: embeddingSource(overrideReason),
      persist: async (result) => {
        await db
          .update(sprintMemberCapacity)
          .set({
            embedding: result.embedding,
            embeddingModel: result.model,
            embeddingUpdatedAt: new Date(),
          })
          .where(
            and(
              eq(sprintMemberCapacity.sprintId, parsed.sprintId),
              eq(sprintMemberCapacity.memberId, parsed.memberId),
            ),
          );
      },
    });
  }
  revalidateSprint();
}

/** Drops an override and recomputes the row from the calendar again. */
export async function resetMemberCapacity(input: {
  sprintId: string;
  memberId: string;
}) {
  const parsed = resetMemberCapacitySchema.parse(input);
  const { session, sprintRow, membership, isSelf } =
    await requireCapacityAccess(parsed.sprintId, parsed.memberId);

  // Back to what this person's availability profile says, not the project
  // default — resetting a part-time member must not silently make them full
  // time.
  const hoursPerDay = await resolveMemberHoursPerDay(
    parsed.memberId,
    sprintRow.defaultHoursPerDay,
  );

  await db
    .update(sprintMemberCapacity)
    .set({
      availabilityPercent: 100,
      hoursPerDay,
      hoursPerDayPinned: false,
      isOverridden: false,
      overrideReason: null,
      embedding: null,
      embeddingModel: null,
      embeddingUpdatedAt: null,
      updatedByMemberId: membership.id,
    })
    .where(
      and(
        eq(sprintMemberCapacity.sprintId, parsed.sprintId),
        eq(sprintMemberCapacity.memberId, parsed.memberId),
      ),
    );

  await recomputeSprintCapacities(parsed.sprintId);

  await recordAudit({
    action: "capacity.reset",
    organizationId: sprintRow.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: parsed.sprintId,
    metadata: { memberId: parsed.memberId, onBehalf: !isSelf },
  });
  revalidateSprint();
}

/** Re-derives every non-overridden row — the "recalculate" button. */
export async function recalculateSprintCapacity(input: { sprintId: string }) {
  const sprintRow = await loadSprintOrThrow(input.sprintId);
  const session = await requireAuth();
  const membership = await findCallerMembership(
    session.user.id,
    sprintRow.organizationId,
  );
  if (!membership) throw new Error("Sprint not found.");

  const permissions = await loadCallerProjectPermissions(
    sprintRow.organizationId,
    sprintRow.projectId,
    session.user.id,
  );
  const allowed =
    projectRoleCan(permissions, "capacity:manage") ||
    (await hasOrgPermission(sprintRow.organizationId, {
      project: ["update"],
    }));
  if (!allowed) {
    throw new Error("You don't have permission to recalculate this sprint.");
  }

  // The one entry point that re-reads hours-per-day from everyone's
  // availability profile — an explicit recalculate means "re-derive from
  // source", where a leave edit only means "the days moved".
  await recomputeSprintCapacities(input.sprintId, {
    resyncHoursFromProfiles: true,
  });

  await recordAudit({
    action: "capacity.recalculated",
    organizationId: sprintRow.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "sprint",
    targetId: input.sprintId,
    metadata: { name: sprintRow.name },
  });
  revalidateSprint();
}
