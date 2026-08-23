import "server-only";
import { and, asc, desc, eq, gt, inArray, lt, max, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  project,
  sprint,
  workflowStatus,
  workItem,
  workItemType,
} from "@/db/schema";
import { between, rankAfter } from "@/lib/rank";
import { canParent } from "@/lib/work-items";

// Shared loaders and reference checks for the backlog server actions.
//
// A plain module, not "use server": those may only export async functions, and
// more importantly every one of these takes an ATTACKER-CONTROLLED id. The rule
// throughout is that scope is derived from the stored row (the item's own
// projectId, the project's own organizationId) and never from what the client
// sent alongside it.

export type BacklogProject = {
  id: string;
  key: string;
  organizationId: string;
  capacityUnit: "hours" | "points";
};

export async function loadProjectOrThrow(
  projectId: string,
): Promise<BacklogProject> {
  const [row] = await db
    .select({
      id: project.id,
      key: project.key,
      organizationId: project.organizationId,
      capacityUnit: project.capacityUnit,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) throw new Error("Project not found.");
  return row;
}

export type StoredWorkItem = {
  id: string;
  organizationId: string;
  projectId: string;
  projectKey: string;
  number: number;
  summary: string;
  typeId: string;
  statusId: string;
  parentId: string | null;
  sprintId: string | null;
  assigneeMemberId: string | null;
  reporterMemberId: string | null;
  rank: string;
  completedAt: Date | null;
};

export async function loadWorkItemOrThrow(
  workItemId: string,
): Promise<StoredWorkItem> {
  const [row] = await db
    .select({
      id: workItem.id,
      organizationId: workItem.organizationId,
      projectId: workItem.projectId,
      projectKey: project.key,
      number: workItem.number,
      summary: workItem.summary,
      typeId: workItem.typeId,
      statusId: workItem.statusId,
      parentId: workItem.parentId,
      sprintId: workItem.sprintId,
      assigneeMemberId: workItem.assigneeMemberId,
      reporterMemberId: workItem.reporterMemberId,
      rank: workItem.rank,
      completedAt: workItem.completedAt,
    })
    .from(workItem)
    .innerJoin(project, eq(workItem.projectId, project.id))
    .where(eq(workItem.id, workItemId))
    .limit(1);
  if (!row) throw new Error("Work item not found.");
  return row;
}

/** The type must belong to the same organization as the project. */
export async function loadTypeInOrgOrThrow(
  typeId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({
      id: workItemType.id,
      name: workItemType.name,
      hierarchyLevel: workItemType.hierarchyLevel,
      strictHierarchy: workItemType.strictHierarchy,
    })
    .from(workItemType)
    .where(
      and(
        eq(workItemType.id, typeId),
        eq(workItemType.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("That work item type isn't available here.");
  return row;
}

export async function loadStatusInProjectOrThrow(
  statusId: string,
  projectId: string,
) {
  const [row] = await db
    .select({
      id: workflowStatus.id,
      name: workflowStatus.name,
      category: workflowStatus.category,
    })
    .from(workflowStatus)
    .where(
      and(
        eq(workflowStatus.id, statusId),
        eq(workflowStatus.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("That status isn't part of this project's flow.");
  return row;
}

/** Where a newly created item lands: the project's default, else its first. */
export async function loadDefaultStatusOrThrow(projectId: string) {
  const [row] = await db
    .select({
      id: workflowStatus.id,
      name: workflowStatus.name,
      category: workflowStatus.category,
    })
    .from(workflowStatus)
    .where(eq(workflowStatus.projectId, projectId))
    .orderBy(desc(workflowStatus.isDefault), workflowStatus.position)
    .limit(1);
  if (!row) {
    throw new Error(
      "This project has no workflow statuses yet. Add one in project settings.",
    );
  }
  return row;
}

export async function assertSprintInProject(
  sprintId: string,
  projectId: string,
) {
  const [row] = await db
    .select({ id: sprint.id, state: sprint.state })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.projectId, projectId)))
    .limit(1);
  if (!row) throw new Error("That sprint isn't part of this project.");
  if (row.state === "completed") {
    throw new Error("That sprint is already completed.");
  }
}

/** An assignee must be a member of the project's organization. */
export async function assertMemberInOrg(
  memberId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  if (!row) throw new Error("That person isn't a member of this organization.");
}

/**
 * A parent must live in the same project, clear the child type's hierarchy
 * rule, and not be the item itself or one of its own descendants — a cycle
 * would make the tree views recurse forever.
 *
 * The level half is the only part a type can waive: with `strictHierarchy` off
 * on the CHILD's type, the level rule is skipped and the item nests anywhere.
 * Self-parenting and cycles are refused whatever the type says.
 */
export async function assertParentAllowed(input: {
  parentId: string;
  projectId: string;
  childTypeLevel: number;
  /** The child type's `strictHierarchy` — the item being placed decides. */
  childTypeStrict: boolean;
  /** Absent when creating: a row that doesn't exist yet can't be a cycle. */
  childId?: string;
}) {
  if (input.childId && input.parentId === input.childId) {
    throw new Error("An item can't be its own parent.");
  }

  const [parent] = await db
    .select({
      id: workItem.id,
      projectId: workItem.projectId,
      parentId: workItem.parentId,
      hierarchyLevel: workItemType.hierarchyLevel,
    })
    .from(workItem)
    .innerJoin(workItemType, eq(workItem.typeId, workItemType.id))
    .where(eq(workItem.id, input.parentId))
    .limit(1);

  if (!parent || parent.projectId !== input.projectId) {
    throw new Error("That parent isn't part of this project.");
  }
  if (
    !canParent(
      parent.hierarchyLevel,
      input.childTypeLevel,
      input.childTypeStrict,
    )
  ) {
    throw new Error(
      "A parent has to be a higher-level type than the item itself.",
    );
  }

  if (!input.childId) return;

  // Walk up from the proposed parent; if we reach the child, the link would
  // close a loop. Bounded so a pre-existing cycle can't hang the request.
  let cursor = parent.parentId;
  for (let hops = 0; cursor && hops < 20; hops += 1) {
    if (cursor === input.childId) {
      throw new Error(
        "That would put the item inside one of its own children.",
      );
    }
    const [next] = await db
      .select({ parentId: workItem.parentId })
      .from(workItem)
      .where(eq(workItem.id, cursor))
      .limit(1);
    cursor = next?.parentId ?? null;
  }
}

/** Monotonic per project. The unique index is still the authority on races. */
export async function nextWorkItemNumber(projectId: string): Promise<number> {
  const [row] = await db
    .select({ value: max(workItem.number) })
    .from(workItem)
    .where(eq(workItem.projectId, projectId));
  return (row?.value ?? 0) + 1;
}

/** The rank for an item appended to the end of a project's backlog. */
export async function nextWorkItemRank(projectId: string): Promise<string> {
  const [row] = await db
    .select({ rank: workItem.rank })
    .from(workItem)
    .where(eq(workItem.projectId, projectId))
    .orderBy(desc(workItem.rank))
    .limit(1);
  return rankAfter(row?.rank ?? null);
}

/**
 * The rank for a drop between two neighbours. Both are ids the client pointed
 * at, resolved against the same project — a client that named its own rank
 * could collide with workItem_projectId_rank_uidx or reorder someone else's
 * project.
 *
 * A missing neighbour means "the end of the LIST THE CLIENT WAS LOOKING AT",
 * which is almost never the end of the project: the backlog is cut into sprint
 * groups (and the board into columns) while `rank` is project-wide and
 * UNIQUE. Dropping at the bottom of a sprint sends `afterId: null`, and
 * `between(lastInSprint, null)` happily lands on a rank another group's item
 * already holds — the unique index then rejects a move nobody raced on. So the
 * open side is closed here, from the project's own rank order, before the
 * midpoint is computed.
 */
export async function rankBetweenNeighbours(input: {
  projectId: string;
  beforeId?: string | null;
  afterId?: string | null;
  /** Excluded from the neighbour lookup: dropping next to itself is a no-op. */
  movingId: string;
}): Promise<string> {
  const ids = [input.beforeId, input.afterId].filter(
    (id): id is string => Boolean(id) && id !== input.movingId,
  );
  if (ids.length === 0) return nextWorkItemRank(input.projectId);

  const rows = await db
    .select({ id: workItem.id, rank: workItem.rank })
    .from(workItem)
    .where(
      and(eq(workItem.projectId, input.projectId), inArray(workItem.id, ids)),
    );
  const rankOf = (id?: string | null) =>
    id && id !== input.movingId
      ? (rows.find((row) => row.id === id)?.rank ?? null)
      : null;

  let lower = rankOf(input.beforeId);
  let upper = rankOf(input.afterId);

  if (lower && !upper) {
    upper = await neighbourRank(input.projectId, lower, input.movingId, "up");
  } else if (upper && !lower) {
    lower = await neighbourRank(input.projectId, upper, input.movingId, "down");
  }

  return between(lower, upper);
}

/**
 * The nearest rank above (`up`) or below (`down`) `anchor` anywhere in the
 * project, or null when `anchor` really is the end of it. The moving row is
 * excluded — it is about to leave the position it currently occupies.
 */
async function neighbourRank(
  projectId: string,
  anchor: string,
  movingId: string,
  direction: "up" | "down",
): Promise<string | null> {
  const [row] = await db
    .select({ rank: workItem.rank })
    .from(workItem)
    .where(
      and(
        eq(workItem.projectId, projectId),
        ne(workItem.id, movingId),
        direction === "up"
          ? gt(workItem.rank, anchor)
          : lt(workItem.rank, anchor),
      ),
    )
    .orderBy(direction === "up" ? asc(workItem.rank) : desc(workItem.rank))
    .limit(1);
  return row?.rank ?? null;
}
