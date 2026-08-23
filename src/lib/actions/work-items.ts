"use server";

import * as Sentry from "@sentry/nextjs";
import { and, asc, desc, eq, inArray, lt, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  member,
  projectMember,
  sprint,
  user,
  workflowStatus,
  workItem,
  workItemAttachment,
  workItemField,
  workItemFieldValue,
  workItemLink,
  workItemType,
} from "@/db/schema";
import type {
  WorkflowStatusCategory,
  WorkItemPriority,
  WorkItemTone,
  WorkItemValueLevel,
} from "@/db/schema/work-items";
import { tryGetAiClient } from "@/lib/ai/client";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import { refreshProjectCommittedPoints } from "@/lib/capacity-sync";
import {
  type EffectiveEstimate,
  effectiveEstimateOf,
} from "@/lib/estimate-rollup";
import { mentionedMemberIdsAcross } from "@/lib/mentions";
import { scheduleNotifications } from "@/lib/notifications";
import {
  assertPlatformNotLocked,
  getPlatformLockdown,
} from "@/lib/platform-lockdown";
import {
  hasOrgPermission,
  isUniqueViolation,
  ProjectPermissionError,
  requireProjectPermission,
} from "@/lib/project-access";
import { between } from "@/lib/rank";
import { projectBacklogTopic, publishRealtime } from "@/lib/realtime";
import { storage } from "@/lib/storage";
import {
  assignWorkItemSchema,
  createWorkItemSchema,
  moveWorkItemSchema,
  moveWorkItemsSchema,
  rescheduleWorkItemSchema,
  setWorkItemAttributesSchema,
  setWorkItemParentSchema,
  updateWorkItemSchema,
  workItemIdSchema,
  workItemLinkSchema,
} from "@/lib/validation/work-items";
import {
  assertMemberInOrg,
  assertParentAllowed,
  assertSprintInProject,
  loadDefaultStatusOrThrow,
  loadProjectOrThrow,
  loadStatusInProjectOrThrow,
  loadTypeInOrgOrThrow,
  loadWorkItemOrThrow,
  nextWorkItemNumber,
  nextWorkItemRank,
  rankBetweenNeighbours,
} from "@/lib/work-item-access";
import {
  callerAttachmentAbilities,
  listWorkItemAttachments,
} from "@/lib/work-item-attachment-access";
import type { WorkItemAttachmentPayload } from "@/lib/work-item-attachments";
import {
  coerceFieldValue,
  fieldsForType,
  isProseField,
  missingRequiredFields,
  type WorkItemFieldDefinition,
} from "@/lib/work-item-fields";
import {
  ensureOrganizationWorkItemTypes,
  ensureProjectWorkflowStatuses,
} from "@/lib/work-item-seed";
import { canParent, workItemKey } from "@/lib/work-items";

// The backlog layer's read and write paths.
//
// Authorization mirrors the sprint actions: requireProjectPermission with an
// org-admin bypass, checked against the project resolved from the STORED row,
// never from an id the client paired with it.

function revalidateBacklog(...projectIds: string[]) {
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog", "page");
  // The detail route by PATTERN, not by a built path: a re-parent changes two
  // items (the one that moved and the parent that gained or lost a child), and
  // a status change is read by every page that lists the item. Invalidating the
  // whole route covers all of them without the mutation having to work out
  // which keys are affected.
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog/[itemKey]", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints/[sprintId]", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]", "page");
  for (const projectId of new Set(projectIds)) {
    publishRealtime({ topic: projectBacklogTopic(projectId) });
  }
}

const VIEW_DENIED = "You don't have permission to view this project's backlog.";
const ORG_BYPASS: Record<string, string[]> = { project: ["update"] };

/** The built-in markdown blocks — every field a mention can be written into. */
const PROSE_FIELDS = [
  "description",
  "acceptanceCriteria",
  "technicalNotes",
  "definitionOfDone",
  "stepsToReproduce",
  "expectedResult",
  "actualResult",
] as const;

/**
 * Page whoever was @-mentioned in the item's prose, and only whoever is NEWLY
 * mentioned.
 *
 * The diff against the previous text is the whole point: an item's description
 * is edited over and over, and re-notifying every name in it on each save is
 * how a mention becomes something people filter to trash. Same rule the comment
 * edit path follows.
 *
 * Ids come from the STORED markdown, never from the client — the form sends
 * prose, not a recipient list — and are then re-resolved against projectMember,
 * so a hand-crafted body can't page someone outside the project.
 */
async function notifyProseMentions(input: {
  organizationId: string;
  projectId: string;
  workItemId: string;
  key: string;
  summary: string;
  projectKey: string;
  bodies: (string | null | undefined)[];
  previousBodies: (string | null | undefined)[];
  actor: {
    id: string;
    name: string;
    email: string;
    memberId: string | null;
  };
}): Promise<void> {
  const already = new Set(mentionedMemberIdsAcross(input.previousBodies));
  const fresh = mentionedMemberIdsAcross(input.bodies).filter(
    (id) => !already.has(id),
  );
  if (fresh.length === 0) return;

  // Resolved here rather than inside scheduleNotifications' own `after()`:
  // nesting one after() inside another is not something Next guarantees, and
  // this is a single indexed lookup.
  const rows = await db
    .select({ memberId: projectMember.memberId })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, input.projectId),
        inArray(projectMember.memberId, fresh),
      ),
    );
  if (rows.length === 0) return;

  scheduleNotifications({
    organizationId: input.organizationId,
    recipientMemberIds: rows.map((row) => row.memberId),
    actor: input.actor,
    // The same sentence a comment mention produces: from the reader's side,
    // being named in a description and being named in a comment are the same
    // event.
    action: "workItem.mentioned",
    targetType: "workItem",
    targetId: input.workItemId,
    metadata: {
      key: input.key,
      summary: input.summary,
      projectKey: input.projectKey,
    },
  });
}

export type WorkItemRow = {
  id: string;
  key: string;
  number: number;
  summary: string;
  description: string | null;
  acceptanceCriteria: string | null;
  technicalNotes: string | null;
  definitionOfDone: string | null;
  stepsToReproduce: string | null;
  expectedResult: string | null;
  actualResult: string | null;
  businessValue: WorkItemValueLevel | null;
  riskLevel: WorkItemValueLevel | null;
  /** Custom field values, keyed by field id. Absent key = unset. */
  customFields: Record<string, unknown>;
  typeId: string;
  statusId: string;
  parentId: string | null;
  sprintId: string | null;
  priority: WorkItemPriority;
  points: number | null;
  actualEfforts: number | null;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  reporterMemberId: string | null;
  startDate: string | null;
  dueDate: string | null;
  labels: string[];
  rank: string;
  completedAt: Date | null;
  updatedAt: Date;
};

export type WorkItemTypeRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  hierarchyLevel: number;
  /** Whether `hierarchyLevel` constrains where items of this type may nest. */
  strictHierarchy: boolean;
  tone: WorkItemTone;
  icon: string;
  isDefault: boolean;
  tracksDefect: boolean;
  position: number;
};

export type WorkflowStatusRow = {
  id: string;
  name: string;
  description: string | null;
  category: WorkflowStatusCategory;
  position: number;
  isDefault: boolean;
  wipLimit: number | null;
};

export type BacklogSprintRow = {
  id: string;
  name: string;
  sequence: number;
  state: "planning" | "active" | "completed";
  startDate: string;
  endDate: string;
  plannedCapacity: number;
};

export type BacklogMemberRow = {
  memberId: string;
  name: string;
  email: string;
  image: string | null;
};

/**
 * Which AI surfaces this organization can actually answer, by model slot. An
 * org can have a text model and no embedding model (or the reverse), and the
 * two power different controls — drafting an item reads the text slot, "find
 * similar" and "suggest estimate" read the embedding slot. Shipped as data
 * because an AI control that can only ever say "AI isn't configured" is worse
 * than no control at all.
 */
export type BacklogAiAbilities = { text: boolean; embedding: boolean };

export type BacklogData = {
  items: WorkItemRow[];
  types: WorkItemTypeRow[];
  /** The organization's custom field catalog, for the item form. */
  fields: WorkItemFieldDefinition[];
  statuses: WorkflowStatusRow[];
  sprints: BacklogSprintRow[];
  members: BacklogMemberRow[];
  ai: BacklogAiAbilities;
};

/**
 * Everything the backlog page's four views need, in one call. The views differ
 * in layout, not in data — fetching per view would mean four round trips to
 * render the same rows, and a board that disagreed with the list beside it.
 */
export async function getBacklogData(input: {
  organizationId: string;
  projectId: string;
}): Promise<BacklogData> {
  await requireProjectPermission(
    input.organizationId,
    input.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  // Self-heal orgs/projects born outside the hooks (SSO provisioning, direct
  // adapter writes) — without a type and a status nothing can be created.
  await ensureOrganizationWorkItemTypes(input.organizationId);
  await ensureProjectWorkflowStatuses(input.projectId);

  const [items, types, statuses, sprints, members, fields, ai] =
    await Promise.all([
      listWorkItems(input.projectId),
      listWorkItemTypes(input.organizationId),
      listWorkflowStatuses(input.projectId),
      listBacklogSprints(input.projectId),
      listProjectMembers(input.projectId),
      listWorkItemFields(input.organizationId),
      // Availability, not credentials: only the two booleans cross the wire.
      tryGetAiClient(input.organizationId),
    ]);

  return {
    items,
    types,
    statuses,
    sprints,
    members,
    fields,
    ai: {
      text: Boolean(ai?.models.text),
      embedding: Boolean(ai?.models.embedding),
    },
  };
}

async function listWorkItems(projectId: string): Promise<WorkItemRow[]> {
  const { key: projectKey } = await loadProjectOrThrow(projectId);
  const rows = await db
    .select({
      id: workItem.id,
      number: workItem.number,
      summary: workItem.summary,
      description: workItem.description,
      acceptanceCriteria: workItem.acceptanceCriteria,
      technicalNotes: workItem.technicalNotes,
      definitionOfDone: workItem.definitionOfDone,
      stepsToReproduce: workItem.stepsToReproduce,
      expectedResult: workItem.expectedResult,
      actualResult: workItem.actualResult,
      businessValue: workItem.businessValue,
      riskLevel: workItem.riskLevel,
      typeId: workItem.typeId,
      statusId: workItem.statusId,
      parentId: workItem.parentId,
      sprintId: workItem.sprintId,
      priority: workItem.priority,
      points: workItem.points,
      actualEfforts: workItem.actualEfforts,
      assigneeMemberId: workItem.assigneeMemberId,
      assigneeName: user.name,
      assigneeImage: user.image,
      reporterMemberId: workItem.reporterMemberId,
      startDate: workItem.startDate,
      dueDate: workItem.dueDate,
      labels: workItem.labels,
      rank: workItem.rank,
      completedAt: workItem.completedAt,
      updatedAt: workItem.updatedAt,
    })
    .from(workItem)
    .leftJoin(member, eq(workItem.assigneeMemberId, member.id))
    .leftJoin(user, eq(member.userId, user.id))
    .where(eq(workItem.projectId, projectId))
    .orderBy(asc(workItem.rank));

  // Custom values in one pass rather than per item: the board renders every
  // row, so a query per item would be a fan-out the size of the backlog.
  const values = await db
    .select({
      workItemId: workItemFieldValue.workItemId,
      fieldId: workItemFieldValue.fieldId,
      value: workItemFieldValue.value,
    })
    .from(workItemFieldValue)
    .innerJoin(workItem, eq(workItemFieldValue.workItemId, workItem.id))
    .where(eq(workItem.projectId, projectId));

  const valuesByItem = new Map<string, Record<string, unknown>>();
  for (const row of values) {
    const bucket = valuesByItem.get(row.workItemId) ?? {};
    bucket[row.fieldId] = row.value;
    valuesByItem.set(row.workItemId, bucket);
  }

  return rows.map((row) => ({
    ...row,
    key: workItemKey(projectKey, row.number),
    customFields: valuesByItem.get(row.id) ?? {},
  }));
}

async function listWorkItemFields(
  organizationId: string,
): Promise<WorkItemFieldDefinition[]> {
  return db
    .select({
      id: workItemField.id,
      key: workItemField.key,
      label: workItemField.label,
      description: workItemField.description,
      fieldType: workItemField.fieldType,
      options: workItemField.options,
      appliesToTypeIds: workItemField.appliesToTypeIds,
      isRequired: workItemField.isRequired,
      helpText: workItemField.helpText,
      placement: workItemField.placement,
      position: workItemField.position,
    })
    .from(workItemField)
    .where(eq(workItemField.organizationId, organizationId))
    .orderBy(asc(workItemField.position), asc(workItemField.label));
}

async function listWorkItemTypes(
  organizationId: string,
): Promise<WorkItemTypeRow[]> {
  return db
    .select({
      id: workItemType.id,
      key: workItemType.key,
      name: workItemType.name,
      description: workItemType.description,
      hierarchyLevel: workItemType.hierarchyLevel,
      strictHierarchy: workItemType.strictHierarchy,
      tone: workItemType.tone,
      icon: workItemType.icon,
      isDefault: workItemType.isDefault,
      tracksDefect: workItemType.tracksDefect,
      position: workItemType.position,
    })
    .from(workItemType)
    .where(eq(workItemType.organizationId, organizationId))
    .orderBy(asc(workItemType.position), asc(workItemType.name));
}

async function listWorkflowStatuses(
  projectId: string,
): Promise<WorkflowStatusRow[]> {
  return db
    .select({
      id: workflowStatus.id,
      name: workflowStatus.name,
      description: workflowStatus.description,
      category: workflowStatus.category,
      position: workflowStatus.position,
      isDefault: workflowStatus.isDefault,
      wipLimit: workflowStatus.wipLimit,
    })
    .from(workflowStatus)
    .where(eq(workflowStatus.projectId, projectId))
    .orderBy(asc(workflowStatus.position), asc(workflowStatus.name));
}

/** Sprints an item can be dropped into, plus any that already hold items. */
async function listBacklogSprints(
  projectId: string,
): Promise<BacklogSprintRow[]> {
  return db
    .select({
      id: sprint.id,
      name: sprint.name,
      sequence: sprint.sequence,
      state: sprint.state,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      plannedCapacity: sprint.plannedCapacity,
    })
    .from(sprint)
    .where(eq(sprint.projectId, projectId))
    .orderBy(asc(sprint.startDate), asc(sprint.sequence));
}

async function listProjectMembers(
  projectId: string,
): Promise<BacklogMemberRow[]> {
  return db
    .select({
      memberId: member.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(projectMember)
    .innerJoin(member, eq(projectMember.memberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(projectMember.projectId, projectId))
    .orderBy(asc(user.name));
}

export async function createWorkItem(input: {
  projectId: string;
  typeId: string;
  statusId?: string;
  summary: string;
  description?: string;
  acceptanceCriteria?: string;
  technicalNotes?: string;
  definitionOfDone?: string;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  businessValue?: WorkItemValueLevel | null;
  riskLevel?: WorkItemValueLevel | null;
  customFields?: Record<string, unknown>;
  priority?: WorkItemPriority;
  points?: number | null;
  actualEfforts?: number | null;
  assigneeMemberId?: string | null;
  parentId?: string | null;
  sprintId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  labels?: string[];
}): Promise<{ id: string; key: string }> {
  const parsed = createWorkItemSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  const session = await requireProjectPermission(
    project.organizationId,
    project.id,
    "item:create",
    ORG_BYPASS,
    "You don't have permission to create work items here.",
  );
  await assertPlatformNotLocked();

  const type = await loadTypeInOrgOrThrow(
    parsed.typeId,
    project.organizationId,
  );
  const status = parsed.statusId
    ? await loadStatusInProjectOrThrow(parsed.statusId, project.id)
    : await loadDefaultStatusOrThrow(project.id);

  if (parsed.parentId) {
    await assertParentAllowed({
      parentId: parsed.parentId,
      projectId: project.id,
      childTypeLevel: type.hierarchyLevel,
      childTypeStrict: type.strictHierarchy,
    });
  }
  if (parsed.sprintId) await assertSprintInProject(parsed.sprintId, project.id);
  if (parsed.assigneeMemberId) {
    await assertMemberInOrg(parsed.assigneeMemberId, project.organizationId);
  }

  const reporter = await callerMemberId(
    project.organizationId,
    session.user.id,
  );
  // New hour-based estimates start at the current hour even when the item was
  // created through a compact entry point that did not render ItemForm. A
  // project that estimates in points keeps its existing unestimated default.
  const estimatedEfforts =
    parsed.points === undefined && project.capacityUnit === "hours"
      ? new Date().getHours()
      : (parsed.points ?? null);

  // The number and the rank are both derived from a read, so two concurrent
  // creates can pick the same one. The unique indexes decide; a retry re-reads
  // rather than guessing further ahead.
  let created: { id: string; number: number } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const number = await nextWorkItemNumber(project.id);
    const rank = await nextWorkItemRank(project.id);
    try {
      const [row] = await db
        .insert(workItem)
        .values({
          organizationId: project.organizationId,
          projectId: project.id,
          number,
          typeId: type.id,
          statusId: status.id,
          parentId: parsed.parentId ?? null,
          sprintId: parsed.sprintId ?? null,
          summary: parsed.summary,
          description: parsed.description || null,
          acceptanceCriteria: parsed.acceptanceCriteria || null,
          technicalNotes: parsed.technicalNotes || null,
          definitionOfDone: parsed.definitionOfDone || null,
          stepsToReproduce: parsed.stepsToReproduce || null,
          expectedResult: parsed.expectedResult || null,
          actualResult: parsed.actualResult || null,
          businessValue: parsed.businessValue ?? null,
          riskLevel: parsed.riskLevel ?? null,
          priority: parsed.priority,
          points: estimatedEfforts,
          actualEfforts: parsed.actualEfforts ?? null,
          assigneeMemberId: parsed.assigneeMemberId ?? null,
          reporterMemberId: reporter,
          startDate: parsed.startDate ?? null,
          dueDate: parsed.dueDate ?? null,
          labels: parsed.labels ?? [],
          rank,
          completedAt: status.category === "done" ? new Date() : null,
        })
        .returning({ id: workItem.id, number: workItem.number });
      created = row;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  if (!created) throw new Error("Couldn't create the work item. Try again.");

  // Not just `parsed.sprintId`'s sprint: a new child re-sums every ancestor,
  // and those ancestors may be scheduled elsewhere.
  await refreshProjectCommittedPoints(project.id);

  const createdId = created.id;
  const key = workItemKey(project.key, created.number);
  const customText = await persistFieldValues({
    workItemId: createdId,
    organizationId: project.organizationId,
    typeId: type.id,
    submitted: parsed.customFields,
  });
  await recordAudit({
    action: "workItem.created",
    organizationId: project.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: createdId,
    metadata: {
      key,
      projectId: project.id,
      summary: parsed.summary,
      typeId: type.id,
      statusId: status.id,
      sprintId: parsed.sprintId ?? null,
    },
  });
  // The reporter is the actor's own membership, so a self-assigned item
  // produces no notification.
  scheduleNotifications({
    organizationId: project.organizationId,
    recipientMemberIds: [parsed.assigneeMemberId],
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: reporter,
    },
    action: "workItem.assigned",
    targetType: "workItem",
    targetId: createdId,
    metadata: { key, summary: parsed.summary, projectKey: project.key },
  });
  await notifyProseMentions({
    organizationId: project.organizationId,
    projectId: project.id,
    workItemId: createdId,
    key,
    summary: parsed.summary,
    projectKey: project.key,
    bodies: PROSE_FIELDS.map((field) => parsed[field]),
    // Nothing was there before, so every name in the new text is new.
    previousBodies: [],
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: reporter,
    },
  });
  scheduleEmbedding({
    organizationId: project.organizationId,
    text: embeddingSource(
      parsed.summary,
      parsed.description,
      parsed.acceptanceCriteria,
      parsed.technicalNotes,
      parsed.definitionOfDone,
      parsed.stepsToReproduce,
      parsed.expectedResult,
      parsed.actualResult,
      ...customText,
    ),
    persist: async (result) => {
      await db
        .update(workItem)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItem.id, createdId));
    },
  });
  revalidateBacklog(project.id);
  return { id: createdId, key };
}

export async function updateWorkItem(input: {
  workItemId: string;
  typeId: string;
  statusId: string;
  summary: string;
  description?: string;
  acceptanceCriteria?: string;
  technicalNotes?: string;
  definitionOfDone?: string;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  businessValue?: WorkItemValueLevel | null;
  riskLevel?: WorkItemValueLevel | null;
  customFields?: Record<string, unknown>;
  priority: WorkItemPriority;
  points?: number | null;
  actualEfforts?: number | null;
  assigneeMemberId?: string | null;
  parentId?: string | null;
  sprintId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  labels?: string[];
}) {
  const parsed = updateWorkItemSchema.parse(input);
  const existing = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "item:update",
    ORG_BYPASS,
    "You don't have permission to edit work items here.",
  );

  const type = await loadTypeInOrgOrThrow(
    parsed.typeId,
    existing.organizationId,
  );
  const status = await loadStatusInProjectOrThrow(
    parsed.statusId,
    existing.projectId,
  );

  // `parentId` is the one PATCH field on an otherwise full-replace action: an
  // ABSENT key means "leave the link where it is", an explicit `null` detaches.
  // The hierarchy panel owns the link and writes it through setWorkItemParent,
  // so a form that shipped its own copy of `parentId` would undo a move the
  // moment its debounced metadata autosave fired with the value it held when
  // the timer was scheduled.
  const nextParentId =
    parsed.parentId === undefined ? existing.parentId : parsed.parentId;

  if (nextParentId) {
    await assertParentAllowed({
      parentId: nextParentId,
      projectId: existing.projectId,
      childTypeLevel: type.hierarchyLevel,
      childTypeStrict: type.strictHierarchy,
      childId: existing.id,
    });
  }
  if (parsed.sprintId) {
    await assertSprintInProject(parsed.sprintId, existing.projectId);
  }
  if (parsed.assigneeMemberId) {
    await assertMemberInOrg(parsed.assigneeMemberId, existing.organizationId);
  }

  // Changing the type can invalidate children that were legal under the old
  // one (a Story demoted to Sub-task can no longer hold its own sub-tasks).
  if (type.id !== existing.typeId) {
    await assertNoChildConflict(existing.id, type.hierarchyLevel);
  }

  // The fields loadWorkItemOrThrow doesn't carry, read before the write so the
  // audit entry can record what each field moved FROM — the History section is
  // only as good as these diffs.
  const [prev] = await db
    .select({
      description: workItem.description,
      acceptanceCriteria: workItem.acceptanceCriteria,
      technicalNotes: workItem.technicalNotes,
      definitionOfDone: workItem.definitionOfDone,
      stepsToReproduce: workItem.stepsToReproduce,
      expectedResult: workItem.expectedResult,
      actualResult: workItem.actualResult,
      businessValue: workItem.businessValue,
      riskLevel: workItem.riskLevel,
      priority: workItem.priority,
      points: workItem.points,
      actualEfforts: workItem.actualEfforts,
      startDate: workItem.startDate,
      dueDate: workItem.dueDate,
      labels: workItem.labels,
    })
    .from(workItem)
    .where(eq(workItem.id, existing.id))
    .limit(1);
  if (!prev) throw new Error("Work item not found.");

  const statusChanged = status.id !== existing.statusId;
  const completedAt = statusChanged
    ? status.category === "done"
      ? (existing.completedAt ?? new Date())
      : null
    : existing.completedAt;

  await db
    .update(workItem)
    .set({
      typeId: type.id,
      statusId: status.id,
      parentId: nextParentId,
      sprintId: parsed.sprintId ?? null,
      summary: parsed.summary,
      description: parsed.description || null,
      acceptanceCriteria: parsed.acceptanceCriteria || null,
      technicalNotes: parsed.technicalNotes || null,
      definitionOfDone: parsed.definitionOfDone || null,
      stepsToReproduce: parsed.stepsToReproduce || null,
      expectedResult: parsed.expectedResult || null,
      actualResult: parsed.actualResult || null,
      businessValue: parsed.businessValue ?? null,
      riskLevel: parsed.riskLevel ?? null,
      priority: parsed.priority,
      points: parsed.points ?? null,
      actualEfforts: parsed.actualEfforts ?? null,
      assigneeMemberId: parsed.assigneeMemberId ?? null,
      startDate: parsed.startDate ?? null,
      dueDate: parsed.dueDate ?? null,
      labels: parsed.labels ?? [],
      completedAt,
    })
    .where(eq(workItem.id, existing.id));

  // Committed is a live roll-up of estimates across a sprint's items. Three
  // things move it: the sprint, the estimate, and the PARENT — re-parenting a
  // sized story changes what two epics are carrying, in whichever sprints they
  // sit. `refreshProjectCommittedPoints` re-sums them all rather than trying to
  // name them.
  const nextSprintId = parsed.sprintId ?? null;
  const sprintChanged = existing.sprintId !== nextSprintId;
  const pointsChanged = prev.points !== (parsed.points ?? null);
  const parentChanged = existing.parentId !== nextParentId;
  if (sprintChanged || pointsChanged || parentChanged) {
    await refreshProjectCommittedPoints(existing.projectId);
  }

  const customText = await persistFieldValues({
    workItemId: existing.id,
    organizationId: existing.organizationId,
    typeId: type.id,
    submitted: parsed.customFields,
  });

  // Field-level before/after pairs, so the item's History section can say what
  // moved rather than just "updated". Prose fields record only WHICH field
  // changed — the append-only log must not hold every draft of a description.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const noteChange = (field: string, from: unknown, to: unknown) => {
    if (from !== to) changes[field] = { from, to };
  };
  noteChange("summary", existing.summary, parsed.summary);
  noteChange("typeId", existing.typeId, type.id);
  noteChange("statusId", existing.statusId, status.id);
  noteChange("parentId", existing.parentId, nextParentId);
  noteChange("sprintId", existing.sprintId, parsed.sprintId ?? null);
  noteChange(
    "assigneeMemberId",
    existing.assigneeMemberId,
    parsed.assigneeMemberId ?? null,
  );
  noteChange("priority", prev.priority, parsed.priority);
  noteChange("points", prev.points, parsed.points ?? null);
  noteChange("actualEfforts", prev.actualEfforts, parsed.actualEfforts ?? null);
  noteChange("startDate", prev.startDate, parsed.startDate ?? null);
  noteChange("dueDate", prev.dueDate, parsed.dueDate ?? null);
  noteChange("businessValue", prev.businessValue, parsed.businessValue ?? null);
  noteChange("riskLevel", prev.riskLevel, parsed.riskLevel ?? null);
  const nextLabels = parsed.labels ?? [];
  // Joined on NUL, written as an escape rather than a literal control character:
  // no label can contain it, so ["a,b"] and ["a","b"] stay distinguishable — and
  // a literal NUL in the source makes git treat this whole file as binary.
  if (prev.labels.join("\0") !== nextLabels.join("\0")) {
    changes.labels = { from: prev.labels, to: nextLabels };
  }
  const proseChanged = (
    [
      ["description", prev.description, parsed.description || null],
      [
        "acceptanceCriteria",
        prev.acceptanceCriteria,
        parsed.acceptanceCriteria || null,
      ],
      ["technicalNotes", prev.technicalNotes, parsed.technicalNotes || null],
      [
        "definitionOfDone",
        prev.definitionOfDone,
        parsed.definitionOfDone || null,
      ],
      [
        "stepsToReproduce",
        prev.stepsToReproduce,
        parsed.stepsToReproduce || null,
      ],
      ["expectedResult", prev.expectedResult, parsed.expectedResult || null],
      ["actualResult", prev.actualResult, parsed.actualResult || null],
    ] as const
  )
    .filter(([, from, to]) => from !== to)
    .map(([field]) => field);

  const key = workItemKey(existing.projectKey, existing.number);
  await recordAudit({
    action: "workItem.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.id,
    metadata: {
      key,
      summary: parsed.summary,
      typeId: type.id,
      statusId: status.id,
      statusChanged,
      sprintId: parsed.sprintId ?? null,
      changes,
      proseChanged,
    },
  });

  // Bell fan-out reads the same diff the audit entry records: a fresh
  // assignment tells the new assignee, a status change tells the people who
  // care where the item stands.
  const actor = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    memberId: await callerMemberId(existing.organizationId, session.user.id),
  };
  const nextAssignee = parsed.assigneeMemberId ?? null;
  if (changes.assigneeMemberId && nextAssignee) {
    scheduleNotifications({
      organizationId: existing.organizationId,
      recipientMemberIds: [nextAssignee],
      actor,
      action: "workItem.assigned",
      targetType: "workItem",
      targetId: existing.id,
      metadata: {
        key,
        summary: parsed.summary,
        projectKey: existing.projectKey,
      },
    });
  }
  if (statusChanged) {
    scheduleNotifications({
      organizationId: existing.organizationId,
      recipientMemberIds: [nextAssignee, existing.reporterMemberId],
      actor,
      action: "workItem.status_changed",
      targetType: "workItem",
      targetId: existing.id,
      metadata: {
        key,
        summary: parsed.summary,
        projectKey: existing.projectKey,
        toStatus: status.name,
      },
    });
  }
  await notifyProseMentions({
    organizationId: existing.organizationId,
    projectId: existing.projectId,
    workItemId: existing.id,
    key,
    summary: parsed.summary,
    projectKey: existing.projectKey,
    bodies: PROSE_FIELDS.map((field) => parsed[field]),
    // `prev` was read before the write for exactly this kind of diff.
    previousBodies: PROSE_FIELDS.map((field) => prev[field]),
    actor,
  });
  scheduleEmbedding({
    organizationId: existing.organizationId,
    text: embeddingSource(
      parsed.summary,
      parsed.description,
      parsed.acceptanceCriteria,
      parsed.technicalNotes,
      parsed.definitionOfDone,
      parsed.stepsToReproduce,
      parsed.expectedResult,
      parsed.actualResult,
      ...customText,
    ),
    persist: async (result) => {
      await db
        .update(workItem)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItem.id, existing.id));
    },
  });
  revalidateBacklog(existing.projectId);
}

/**
 * One drag, from any of the views: a new column, a new sprint, a new parent, a
 * new position, or several at once. Rank comes from the neighbours the client
 * pointed at, so the server owns the ordering value.
 *
 * A drop that re-parents AND re-ranks is ONE write here, not a call to
 * `setWorkItemParent` followed by this one: the two need different permissions,
 * so a caller holding only `item:update` would land the parent and then be
 * refused the rank, leaving the row half-moved under a UI that had already
 * rolled its optimistic state back.
 *
 * REFUSALS ARE RETURNED, NOT THROWN. A production build replaces every thrown
 * message with a generic digest string, so a drag refused for want of a
 * permission (or lost to a concurrent drop) reached the user as "An error
 * occurred in the Server Components render" — text that names neither the cause
 * nor the fix. The two outcomes a user is meant to act on come back as
 * `{ error }`; everything else still throws and reaches Sentry.
 */
export async function moveWorkItem(input: {
  workItemId: string;
  statusId?: string;
  sprintId?: string | null;
  parentId?: string | null;
  beforeId?: string | null;
  afterId?: string | null;
}): Promise<{ error?: string }> {
  const parsed = moveWorkItemSchema.parse(input);
  const existing = await loadWorkItemOrThrow(parsed.workItemId);

  // A move can change three different things, and they aren't the same right:
  // dropping a card in another column is editing the item, while reordering or
  // scheduling it into a sprint is backlog work.
  const changesStatus = Boolean(
    parsed.statusId && parsed.statusId !== existing.statusId,
  );
  const changesSprint =
    parsed.sprintId !== undefined &&
    (parsed.sprintId ?? null) !== existing.sprintId;
  const changesRank = Boolean(parsed.beforeId || parsed.afterId);
  const changesParent =
    parsed.parentId !== undefined &&
    (parsed.parentId ?? null) !== existing.parentId;

  let session: Awaited<ReturnType<typeof requireProjectPermission>>;
  try {
    // A no-op drag (dropped back where it started) still has to prove the
    // caller may touch the item at all, so the fallback gate is
    // backlog:prioritize.
    session = changesStatus
      ? await requireProjectPermission(
          existing.organizationId,
          existing.projectId,
          "item:update",
          ORG_BYPASS,
          "You don't have permission to move work items here.",
        )
      : await requireProjectPermission(
          existing.organizationId,
          existing.projectId,
          "backlog:prioritize",
          ORG_BYPASS,
          "You don't have permission to reorder this backlog.",
        );

    // A drag that changes the column AND the sprint needs both rights.
    if (changesStatus && (changesSprint || changesRank)) {
      await requireProjectPermission(
        existing.organizationId,
        existing.projectId,
        "backlog:prioritize",
        ORG_BYPASS,
        "You don't have permission to reorder this backlog.",
      );
    }
    // Re-parenting is an edit, whatever else the same drop did — and it is
    // checked BEFORE the single write, so the rank half can't outlive it.
    if (changesParent) {
      await requireProjectPermission(
        existing.organizationId,
        existing.projectId,
        "item:update",
        ORG_BYPASS,
        "You don't have permission to edit work items here.",
      );
      await assertPlatformNotLocked();
    }
  } catch (error) {
    if (error instanceof ProjectPermissionError)
      return { error: error.message };
    throw error;
  }

  const status = parsed.statusId
    ? await loadStatusInProjectOrThrow(parsed.statusId, existing.projectId)
    : null;
  if (parsed.sprintId) {
    await assertSprintInProject(parsed.sprintId, existing.projectId);
  }
  if (changesParent && parsed.parentId) {
    const type = await loadTypeInOrgOrThrow(
      existing.typeId,
      existing.organizationId,
    );
    await assertParentAllowed({
      parentId: parsed.parentId,
      projectId: existing.projectId,
      childTypeLevel: type.hierarchyLevel,
      childTypeStrict: type.strictHierarchy,
      childId: existing.id,
    });
  }

  const rank = changesRank
    ? await rankBetweenNeighbours({
        projectId: existing.projectId,
        beforeId: parsed.beforeId,
        afterId: parsed.afterId,
        movingId: existing.id,
      })
    : existing.rank;

  const completedAt =
    status && status.id !== existing.statusId
      ? status.category === "done"
        ? (existing.completedAt ?? new Date())
        : null
      : existing.completedAt;

  try {
    await db
      .update(workItem)
      .set({
        statusId: status?.id ?? existing.statusId,
        sprintId:
          parsed.sprintId === undefined
            ? existing.sprintId
            : (parsed.sprintId ?? null),
        parentId: changesParent ? (parsed.parentId ?? null) : existing.parentId,
        rank,
        completedAt,
      })
      .where(eq(workItem.id, existing.id));
  } catch (error) {
    // Two people dropping onto the same gap can compute the same rank; the
    // unique index catches it and the retry re-reads the neighbours.
    if (!isUniqueViolation(error)) throw error;
    return {
      error: "Someone else moved an item there. Refresh and try again.",
    };
  }

  // Only the sprint and the parent move committed — a rank reorder is the most
  // frequent drag in the product and changes no sprint's total, so it must not
  // pay for a whole-project re-sum. When one of them DID change, the re-sum is
  // project-wide because either reaches sprints this item was never in (see
  // `refreshProjectCommittedPoints`).
  if (changesSprint || changesParent) {
    await refreshProjectCommittedPoints(existing.projectId);
  }

  await recordAudit({
    action: "workItem.moved",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.id,
    metadata: {
      key: workItemKey(existing.projectKey, existing.number),
      fromStatusId: existing.statusId,
      toStatusId: status?.id ?? existing.statusId,
      fromSprintId: existing.sprintId,
      toSprintId:
        parsed.sprintId === undefined
          ? existing.sprintId
          : (parsed.sprintId ?? null),
      reordered: changesRank,
    },
  });
  // A second entry rather than a field on `workItem.moved`: the item's History
  // section renders "Parent: PROJ-1 → PROJ-4" off `workItem.updated`'s changes
  // map, and a re-parent should read the same whether it came from a drag or
  // from the hierarchy panel.
  if (changesParent) {
    await recordAudit({
      action: "workItem.updated",
      organizationId: existing.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: existing.id,
      metadata: {
        key: workItemKey(existing.projectKey, existing.number),
        changes: {
          parentId: { from: existing.parentId, to: parsed.parentId ?? null },
        },
      },
    });
  }
  if (changesStatus && status) {
    scheduleNotifications({
      organizationId: existing.organizationId,
      recipientMemberIds: [
        existing.assigneeMemberId,
        existing.reporterMemberId,
      ],
      actor: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        memberId: await callerMemberId(
          existing.organizationId,
          session.user.id,
        ),
      },
      action: "workItem.status_changed",
      targetType: "workItem",
      targetId: existing.id,
      metadata: {
        key: workItemKey(existing.projectKey, existing.number),
        summary: existing.summary,
        projectKey: existing.projectKey,
        toStatus: status.name,
      },
    });
  }
  revalidateBacklog(existing.projectId);
  return {};
}

/**
 * Move a selected backlog block in one request. Unlike repeating
 * `moveWorkItem`, this checks the project and permission once, writes every
 * rank in a transaction, and invalidates the backlog once after the batch.
 */
export async function moveWorkItems(input: {
  workItemIds: string[];
  sprintId?: string | null;
  beforeId?: string | null;
  afterId?: string | null;
}): Promise<{ error?: string }> {
  const parsed = moveWorkItemsSchema.parse(input);
  const movingIds = new Set(parsed.workItemIds);
  if (
    movingIds.has(parsed.beforeId ?? "") ||
    movingIds.has(parsed.afterId ?? "")
  ) {
    return { error: "Drop beside the selected items, not onto them." };
  }

  const rows = await db
    .select({
      id: workItem.id,
      organizationId: workItem.organizationId,
      projectId: workItem.projectId,
      number: workItem.number,
      sprintId: workItem.sprintId,
      rank: workItem.rank,
    })
    .from(workItem)
    .where(inArray(workItem.id, parsed.workItemIds));
  const first = rows[0];
  if (
    !first ||
    rows.length !== parsed.workItemIds.length ||
    rows.some((row) => row.projectId !== first.projectId)
  ) {
    return { error: "Selected items must belong to the same project." };
  }

  let session: Awaited<ReturnType<typeof requireProjectPermission>>;
  try {
    session = await requireProjectPermission(
      first.organizationId,
      first.projectId,
      "backlog:prioritize",
      ORG_BYPASS,
      "You don't have permission to reorder this backlog.",
    );
  } catch (error) {
    if (error instanceof ProjectPermissionError)
      return { error: error.message };
    throw error;
  }
  if (parsed.sprintId)
    await assertSprintInProject(parsed.sprintId, first.projectId);
  const project = await loadProjectOrThrow(first.projectId);

  const ranked = await db
    .select({ id: workItem.id, rank: workItem.rank })
    .from(workItem)
    .where(eq(workItem.projectId, first.projectId))
    .orderBy(asc(workItem.rank));
  const outside = ranked.filter((row) => !movingIds.has(row.id));
  const beforeRank = parsed.beforeId
    ? outside.find((row) => row.id === parsed.beforeId)?.rank
    : null;
  const afterRank = parsed.afterId
    ? outside.find((row) => row.id === parsed.afterId)?.rank
    : null;
  if ((parsed.beforeId && !beforeRank) || (parsed.afterId && !afterRank)) {
    return { error: "The drop position changed. Refresh and try again." };
  }

  let lower = beforeRank ?? null;
  let upper = afterRank ?? null;
  if (lower && !upper) {
    const lowerRank = lower;
    upper = outside.find((row) => row.rank > lowerRank)?.rank ?? null;
  } else if (upper && !lower) {
    const upperRank = upper;
    lower =
      [...outside].reverse().find((row) => row.rank < upperRank)?.rank ?? null;
  }
  const ranks = parsed.workItemIds.map(() => {
    lower = between(lower, upper);
    return lower;
  });

  try {
    await db.transaction(async (tx) => {
      // The unique rank index is immediate. Park every moving row at a unique
      // transaction-local value before assigning its final rank, so a selected
      // row's old rank cannot collide with another row in the same block.
      for (const id of parsed.workItemIds) {
        await tx
          .update(workItem)
          .set({ rank: `!moving-${id}` })
          .where(eq(workItem.id, id));
      }
      for (const [index, id] of parsed.workItemIds.entries()) {
        await tx
          .update(workItem)
          .set({
            rank: ranks[index],
            sprintId:
              parsed.sprintId === undefined
                ? undefined
                : (parsed.sprintId ?? null),
          })
          .where(eq(workItem.id, id));
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        error: "Someone else moved an item there. Refresh and try again.",
      };
    }
    throw error;
  }

  if (
    parsed.sprintId !== undefined &&
    rows.some((row) => row.sprintId !== (parsed.sprintId ?? null))
  ) {
    await refreshProjectCommittedPoints(first.projectId);
  }
  await recordAudit({
    action: "workItem.bulkMoved",
    organizationId: first.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: first.projectId,
    metadata: {
      count: parsed.workItemIds.length,
      keys: rows.map((row) => workItemKey(project.key, row.number)),
      sprintId: parsed.sprintId,
    },
  });
  revalidateBacklog(first.projectId);
  return {};
}

export async function assignWorkItem(input: {
  workItemId: string;
  assigneeMemberId: string | null;
}) {
  const parsed = assignWorkItemSchema.parse(input);
  const existing = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "item:assign",
    ORG_BYPASS,
    "You don't have permission to assign work items here.",
  );

  if (parsed.assigneeMemberId) {
    await assertMemberInOrg(parsed.assigneeMemberId, existing.organizationId);
  }

  await db
    .update(workItem)
    .set({ assigneeMemberId: parsed.assigneeMemberId })
    .where(eq(workItem.id, existing.id));

  await recordAudit({
    action: "workItem.assigned",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.id,
    metadata: {
      key: workItemKey(existing.projectKey, existing.number),
      assigneeMemberId: parsed.assigneeMemberId,
      fromAssigneeMemberId: existing.assigneeMemberId,
    },
  });
  if (parsed.assigneeMemberId) {
    scheduleNotifications({
      organizationId: existing.organizationId,
      recipientMemberIds: [parsed.assigneeMemberId],
      actor: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        memberId: await callerMemberId(
          existing.organizationId,
          session.user.id,
        ),
      },
      action: "workItem.assigned",
      targetType: "workItem",
      targetId: existing.id,
      metadata: {
        key: workItemKey(existing.projectKey, existing.number),
        summary: existing.summary,
        projectKey: existing.projectKey,
      },
    });
  }
  revalidateBacklog(existing.projectId);
}

/**
 * The backlog's right-click menu: ONE attribute, set on the row that was
 * clicked or on the whole selection.
 *
 * Deliberately not routed through `updateWorkItem`: that action is a full
 * replace, and the list holds no prose, so setting a sprint through it would
 * null every block the row never loaded. It is also not four actions, because
 * the menu's items are four spellings of the same gesture and each one would
 * otherwise repeat the same batch resolution, audit and revalidate.
 *
 * PERMISSIONS ARE PER ATTRIBUTE, not per call — they aren't the same right.
 * Assigning is `item:assign`, scheduling into a sprint is `backlog:prioritize`
 * (the same gate the drag already passes), and status / priority / estimate are
 * `item:update`. A payload carrying several of them must clear all of them.
 *
 * REFUSALS ARE RETURNED, NOT THROWN, for the same reason `moveWorkItem`
 * returns them: production strips the message off anything a server action
 * throws, so a menu click refused for want of a permission would otherwise
 * reach the user as an opaque digest.
 *
 * The batch is scoped to the project resolved from the FIRST id, so a
 * hand-built mixed-project payload can only touch the project the caller was
 * actually authorized against.
 */
export async function setWorkItemAttributes(input: {
  workItemIds: string[];
  statusId?: string;
  sprintId?: string | null;
  assigneeMemberId?: string | null;
  priority?: WorkItemPriority;
  points?: number | null;
}): Promise<{ error?: string; updated?: number }> {
  const parsed = setWorkItemAttributesSchema.parse(input);

  const setsStatus = parsed.statusId !== undefined;
  const setsSprint = parsed.sprintId !== undefined;
  const setsAssignee = parsed.assigneeMemberId !== undefined;
  const setsPriority = parsed.priority !== undefined;
  const setsPoints = parsed.points !== undefined;
  // Nothing asked for is not an error — it is a menu that closed on itself.
  if (
    !setsStatus &&
    !setsSprint &&
    !setsAssignee &&
    !setsPriority &&
    !setsPoints
  ) {
    return { updated: 0 };
  }

  const first = await loadWorkItemOrThrow(parsed.workItemIds[0]);

  let session: Awaited<ReturnType<typeof requireProjectPermission>> | null =
    null;
  try {
    if (setsStatus || setsPriority || setsPoints) {
      session = await requireProjectPermission(
        first.organizationId,
        first.projectId,
        "item:update",
        ORG_BYPASS,
        "You don't have permission to edit work items here.",
      );
    }
    if (setsAssignee) {
      session = await requireProjectPermission(
        first.organizationId,
        first.projectId,
        "item:assign",
        ORG_BYPASS,
        "You don't have permission to assign work items here.",
      );
    }
    if (setsSprint) {
      session = await requireProjectPermission(
        first.organizationId,
        first.projectId,
        "backlog:prioritize",
        ORG_BYPASS,
        "You don't have permission to schedule this backlog.",
      );
    }
  } catch (error) {
    if (error instanceof ProjectPermissionError)
      return { error: error.message };
    throw error;
  }
  if (!session) return { updated: 0 };

  // The emergency lockdown outranks every permission the caller cleared above:
  // the same freeze that stops a create, an edit, a re-parent or a drag stops a
  // menu edit. Read as a value rather than through `assertPlatformNotLocked()`
  // so the admin-set message is RETURNED like the permission refusals — a throw
  // reaches the menu as an opaque digest.
  const lockdown = await getPlatformLockdown();
  if (lockdown.enabled) return { error: lockdown.message };

  const status = parsed.statusId
    ? await loadStatusInProjectOrThrow(parsed.statusId, first.projectId)
    : null;
  if (parsed.sprintId) {
    await assertSprintInProject(parsed.sprintId, first.projectId);
  }
  if (parsed.assigneeMemberId) {
    await assertMemberInOrg(parsed.assigneeMemberId, first.organizationId);
  }

  // Read before the write, so each audit entry can say what the field moved
  // FROM — the item's History section is only as good as these diffs — and so a
  // row that is already there is skipped rather than re-written.
  const rows = await db
    .select({
      id: workItem.id,
      number: workItem.number,
      summary: workItem.summary,
      statusId: workItem.statusId,
      sprintId: workItem.sprintId,
      assigneeMemberId: workItem.assigneeMemberId,
      reporterMemberId: workItem.reporterMemberId,
      priority: workItem.priority,
      points: workItem.points,
      completedAt: workItem.completedAt,
    })
    .from(workItem)
    .where(
      and(
        eq(workItem.projectId, first.projectId),
        inArray(workItem.id, parsed.workItemIds),
      ),
    );

  const actorMemberId = await callerMemberId(
    first.organizationId,
    session.user.id,
  );
  const actor = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    memberId: actorMemberId,
  };
  // Whether the batch touched sprints or estimates at all — either one leaves
  // committed roll-ups stale, and a re-estimated row moves the sprints its
  // ANCESTORS sit in, not the one it is in.
  let touchesCommitted = false;
  let updated = 0;

  for (const row of rows) {
    const patch: Partial<typeof workItem.$inferInsert> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (status && status.id !== row.statusId) {
      patch.statusId = status.id;
      // Same rule the drag follows: entering a done column stamps the
      // completion, leaving one clears it.
      patch.completedAt =
        status.category === "done" ? (row.completedAt ?? new Date()) : null;
      changes.statusId = { from: row.statusId, to: status.id };
    }
    if (setsSprint) {
      const next = parsed.sprintId ?? null;
      if (next !== row.sprintId) {
        patch.sprintId = next;
        changes.sprintId = { from: row.sprintId, to: next };
        touchesCommitted = true;
      }
    }
    if (setsAssignee) {
      const next = parsed.assigneeMemberId ?? null;
      if (next !== row.assigneeMemberId) {
        patch.assigneeMemberId = next;
        changes.assigneeMemberId = { from: row.assigneeMemberId, to: next };
      }
    }
    if (parsed.priority !== undefined && parsed.priority !== row.priority) {
      patch.priority = parsed.priority;
      changes.priority = { from: row.priority, to: parsed.priority };
    }
    if (setsPoints) {
      const next = parsed.points ?? null;
      if (next !== row.points) {
        patch.points = next;
        changes.points = { from: row.points, to: next };
        touchesCommitted = true;
      }
    }

    // Already exactly there — writing anyway would spend an audit row on a
    // change nobody made.
    if (Object.keys(patch).length === 0) continue;

    await db.update(workItem).set(patch).where(eq(workItem.id, row.id));
    updated += 1;

    const key = workItemKey(first.projectKey, row.number);
    // `workItem.updated` with a changes map rather than a verb per attribute,
    // so History renders "Assignee: A → B" through the same path a sidebar
    // edit already takes.
    await recordAudit({
      action: "workItem.updated",
      organizationId: first.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: row.id,
      metadata: { key, changes },
    });

    if (patch.assigneeMemberId) {
      scheduleNotifications({
        organizationId: first.organizationId,
        recipientMemberIds: [patch.assigneeMemberId],
        actor,
        action: "workItem.assigned",
        targetType: "workItem",
        targetId: row.id,
        metadata: { key, summary: row.summary, projectKey: first.projectKey },
      });
    }
    if (patch.statusId && status) {
      scheduleNotifications({
        organizationId: first.organizationId,
        // Whoever is carrying the item and whoever raised it — the same pair
        // the drag pages when it changes a column.
        recipientMemberIds: [row.assigneeMemberId, row.reporterMemberId],
        actor,
        action: "workItem.status_changed",
        targetType: "workItem",
        targetId: row.id,
        metadata: {
          key,
          summary: row.summary,
          projectKey: first.projectKey,
          toStatus: status.name,
        },
      });
    }
  }

  if (touchesCommitted) await refreshProjectCommittedPoints(first.projectId);

  if (updated > 0) revalidateBacklog(first.projectId);
  return { updated };
}

/**
 * Move ONE item under a parent, or detach it (`parentId: null`).
 *
 * The hierarchy panel drives both directions through this single action: "link
 * a parent" sends the item you're looking at, "link a child" sends the CHILD as
 * `workItemId`. That symmetry is what makes the permission check honest — the
 * row being re-parented is the row whose project is checked, so linking a child
 * you may not edit is refused even though you may edit the parent.
 *
 * Deliberately not routed through `updateWorkItem`: that action is a full
 * replace, so a re-parent through it would ship every prose block back and
 * clobber whatever another tab saved in between.
 */
export async function setWorkItemParent(input: {
  workItemId: string;
  parentId: string | null;
}) {
  const parsed = setWorkItemParentSchema.parse(input);
  const existing = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "item:update",
    ORG_BYPASS,
    "You don't have permission to edit work items here.",
  );
  await assertPlatformNotLocked();

  // Nothing to do — and saying so beats an audit entry recording a non-change.
  if (existing.parentId === parsed.parentId) return;

  if (parsed.parentId) {
    const type = await loadTypeInOrgOrThrow(
      existing.typeId,
      existing.organizationId,
    );
    await assertParentAllowed({
      parentId: parsed.parentId,
      projectId: existing.projectId,
      childTypeLevel: type.hierarchyLevel,
      childTypeStrict: type.strictHierarchy,
      childId: existing.id,
    });
  }

  await db
    .update(workItem)
    .set({ parentId: parsed.parentId })
    .where(eq(workItem.id, existing.id));

  // `workItem.updated` with a `changes` map rather than a verb of its own, so
  // the item's History section renders "Parent: PROJ-1 → PROJ-4" through the
  // same path every other field edit already takes.
  await recordAudit({
    action: "workItem.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.id,
    metadata: {
      key: workItemKey(existing.projectKey, existing.number),
      changes: {
        parentId: { from: existing.parentId, to: parsed.parentId },
      },
    },
  });
  revalidateBacklog(existing.projectId);
}

/**
 * Adds a symmetric related-item link. Unlike `setWorkItemParent`, neither item
 * moves in the hierarchy; the pair is canonicalized so linking A→B and B→A
 * cannot create duplicates.
 */
export async function linkWorkItems(input: {
  workItemId: string;
  relatedWorkItemId: string;
}) {
  const parsed = workItemLinkSchema.parse(input);
  if (parsed.workItemId === parsed.relatedWorkItemId) {
    throw new Error("An item can't be related to itself.");
  }

  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const related = await loadWorkItemOrThrow(parsed.relatedWorkItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "item:update",
    ORG_BYPASS,
    "You don't have permission to edit work items here.",
  );
  await assertPlatformNotLocked();

  if (related.projectId !== item.projectId) {
    throw new Error("Related work items must belong to the same project.");
  }

  const [sourceWorkItemId, targetWorkItemId] =
    item.id < related.id ? [item.id, related.id] : [related.id, item.id];
  const inserted = await db
    .insert(workItemLink)
    .values({ sourceWorkItemId, targetWorkItemId })
    .onConflictDoNothing()
    .returning({ sourceWorkItemId: workItemLink.sourceWorkItemId });
  if (inserted.length === 0) return;

  await Promise.all(
    [item, related].map((current, index) => {
      const other = index === 0 ? related : item;
      return recordAudit({
        action: "workItem.related",
        organizationId: item.organizationId,
        actor: { id: session.user.id, email: session.user.email },
        targetType: "workItem",
        targetId: current.id,
        metadata: {
          key: workItemKey(current.projectKey, current.number),
          relatedKey: workItemKey(other.projectKey, other.number),
          relatedWorkItemId: other.id,
        },
      });
    }),
  );
  revalidateBacklog(item.projectId, related.projectId);
}

/** Removes the same canonical peer relationship created by `linkWorkItems`. */
export async function unlinkWorkItems(input: {
  workItemId: string;
  relatedWorkItemId: string;
}) {
  const parsed = workItemLinkSchema.parse(input);
  if (parsed.workItemId === parsed.relatedWorkItemId) return;

  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const related = await loadWorkItemOrThrow(parsed.relatedWorkItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "item:update",
    ORG_BYPASS,
    "You don't have permission to edit work items here.",
  );
  await assertPlatformNotLocked();
  if (related.projectId !== item.projectId) {
    throw new Error("Related work items must belong to the same project.");
  }

  const [sourceWorkItemId, targetWorkItemId] =
    item.id < related.id ? [item.id, related.id] : [related.id, item.id];
  const deleted = await db
    .delete(workItemLink)
    .where(
      and(
        eq(workItemLink.sourceWorkItemId, sourceWorkItemId),
        eq(workItemLink.targetWorkItemId, targetWorkItemId),
      ),
    )
    .returning({ sourceWorkItemId: workItemLink.sourceWorkItemId });
  if (deleted.length === 0) return;

  await Promise.all(
    [item, related].map((current, index) => {
      const other = index === 0 ? related : item;
      return recordAudit({
        action: "workItem.unrelated",
        organizationId: item.organizationId,
        actor: { id: session.user.id, email: session.user.email },
        targetType: "workItem",
        targetId: current.id,
        metadata: {
          key: workItemKey(current.projectKey, current.number),
          relatedKey: workItemKey(other.projectKey, other.number),
          relatedWorkItemId: other.id,
        },
      });
    }),
  );
  revalidateBacklog(item.projectId, related.projectId);
}

/**
 * Move ONE item's dates — the timeline's drag and resize.
 *
 * Deliberately not routed through `updateWorkItem` for the same reason
 * `setWorkItemParent` isn't: that action replaces the whole row, so a view that
 * only holds an item's dates would have to echo every prose block back to shift
 * a bar, and would null the blocks it never loaded.
 */
export async function rescheduleWorkItem(input: {
  workItemId: string;
  startDate: string | null;
  dueDate: string | null;
}) {
  const parsed = rescheduleWorkItemSchema.parse(input);
  const existing = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "item:update",
    ORG_BYPASS,
    "You don't have permission to edit work items here.",
  );
  await assertPlatformNotLocked();

  // The dates StoredWorkItem doesn't carry, read before the write so History
  // can say what each one moved FROM.
  const [prev] = await db
    .select({ startDate: workItem.startDate, dueDate: workItem.dueDate })
    .from(workItem)
    .where(eq(workItem.id, existing.id))
    .limit(1);
  if (!prev) throw new Error("Work item not found.");

  if (prev.startDate === parsed.startDate && prev.dueDate === parsed.dueDate) {
    return;
  }

  await db
    .update(workItem)
    .set({ startDate: parsed.startDate, dueDate: parsed.dueDate })
    .where(eq(workItem.id, existing.id));

  // `workItem.updated` with a `changes` map rather than a verb of its own, so
  // the History section renders the move through the same path a sidebar date
  // edit already takes.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (prev.startDate !== parsed.startDate) {
    changes.startDate = { from: prev.startDate, to: parsed.startDate };
  }
  if (prev.dueDate !== parsed.dueDate) {
    changes.dueDate = { from: prev.dueDate, to: parsed.dueDate };
  }
  await recordAudit({
    action: "workItem.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.id,
    metadata: {
      key: workItemKey(existing.projectKey, existing.number),
      changes,
    },
  });
  revalidateBacklog(existing.projectId);
}

export async function deleteWorkItem(input: { workItemId: string }) {
  const parsed = workItemIdSchema.parse(input);
  const existing = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "item:delete",
    ORG_BYPASS,
    "You don't have permission to delete work items here.",
  );

  // The attachment ROWS go with the item (ON DELETE CASCADE), but the bytes
  // live in the object store, which no foreign key reaches — so the keys are
  // read while the rows still exist and the objects are cleared afterwards.
  // Deleting an object is idempotent and best-effort: a store hiccup must not
  // resurrect a deleted item, and what it leaves behind is visible in the
  // platform storage browser.
  //
  // Reading the keys and deleting the item are ONE transaction, opened by the
  // same `FOR UPDATE` the upload route takes (insertAttachmentRows): an upload
  // committing between an unlocked read and the cascade would lose its row and
  // never appear in the key list, leaving its bytes behind forever. Under the
  // lock it either lands first and is collected here, or finds no item and
  // refuses.
  //
  // Children are orphaned to the top level rather than deleted with the parent
  // (the FK is ON DELETE SET NULL) — losing a whole epic's worth of stories to
  // one confirm would be worse than leaving them where they can be re-filed.
  const attachedKeys = await db.transaction(async (tx) => {
    await tx
      .select({ id: workItem.id })
      .from(workItem)
      .where(eq(workItem.id, existing.id))
      .for("update")
      .limit(1);

    const keys = await tx
      .select({ storageKey: workItemAttachment.storageKey })
      .from(workItemAttachment)
      .where(eq(workItemAttachment.workItemId, existing.id));

    await tx.delete(workItem).where(eq(workItem.id, existing.id));
    return keys;
  });

  for (const row of attachedKeys) {
    await storage()
      .delete(row.storageKey)
      .catch((error: unknown) => {
        Sentry.captureException(error);
      });
  }

  // Deleting a child shrinks every ancestor's roll-up, so the sprints those
  // ancestors sit in are stale too — and the chain is gone by now.
  await refreshProjectCommittedPoints(existing.projectId);

  await recordAudit({
    action: "workItem.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.id,
    metadata: {
      key: workItemKey(existing.projectKey, existing.number),
      summary: existing.summary,
    },
  });
  scheduleNotifications({
    organizationId: existing.organizationId,
    recipientMemberIds: [existing.assigneeMemberId, existing.reporterMemberId],
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: await callerMemberId(existing.organizationId, session.user.id),
    },
    action: "workItem.deleted",
    targetType: "workItem",
    targetId: existing.id,
    metadata: {
      key: workItemKey(existing.projectKey, existing.number),
      summary: existing.summary,
      projectKey: existing.projectKey,
    },
  });
  revalidateBacklog(existing.projectId);
}

/**
 * Validates and writes an item's custom field values, and returns their text
 * for the embedding.
 *
 * The definitions are re-read from the database rather than trusted from the
 * request: the client's catalog can be minutes old, and a field's options,
 * required flag or type may all have moved since the form was rendered.
 * `coerceFieldValue` is the same function the form used — shared so the dialog
 * can never offer a value this refuses.
 */
async function persistFieldValues(input: {
  workItemId: string;
  organizationId: string;
  typeId: string;
  submitted: Record<string, unknown> | undefined;
}): Promise<string[]> {
  const catalog = await db
    .select({
      id: workItemField.id,
      key: workItemField.key,
      label: workItemField.label,
      description: workItemField.description,
      fieldType: workItemField.fieldType,
      options: workItemField.options,
      appliesToTypeIds: workItemField.appliesToTypeIds,
      isRequired: workItemField.isRequired,
      helpText: workItemField.helpText,
      placement: workItemField.placement,
      position: workItemField.position,
    })
    .from(workItemField)
    .where(eq(workItemField.organizationId, input.organizationId));

  const applicable = fieldsForType(catalog, input.typeId);
  const submitted = input.submitted ?? {};

  const missing = missingRequiredFields(applicable, submitted);
  if (missing.length > 0) {
    throw new Error(
      `${missing.map((field) => field.label).join(", ")} ${missing.length === 1 ? "is" : "are"} required.`,
    );
  }

  const prose: string[] = [];
  const rows: {
    fieldId: string;
    value: unknown;
    textValue: string | null;
  }[] = [];

  for (const field of applicable) {
    const coerced = coerceFieldValue(field, submitted[field.id]);
    if ("error" in coerced) {
      throw new Error(`${field.label}: ${coerced.error}`);
    }
    if (coerced.value === null) continue;

    if (field.fieldType === "user") {
      await assertMemberInOrg(String(coerced.value), input.organizationId);
    }
    rows.push({
      fieldId: field.id,
      value: coerced.value,
      textValue: coerced.text,
    });
    if (isProseField(field.fieldType) && coerced.text) {
      prose.push(`${field.label}: ${coerced.text}`);
    }
  }

  // Replace rather than merge: a field cleared in the form has to lose its row,
  // and a field that no longer applies to this item's type must not keep a
  // stale value that nothing renders. Values for fields OUTSIDE the item's type
  // are deleted for the same reason — after a type change they are unreachable.
  await db
    .delete(workItemFieldValue)
    .where(eq(workItemFieldValue.workItemId, input.workItemId));
  if (rows.length > 0) {
    await db.insert(workItemFieldValue).values(
      rows.map((row) => ({
        workItemId: input.workItemId,
        fieldId: row.fieldId,
        value: row.value,
        textValue: row.textValue,
      })),
    );
  }

  return prose;
}

/** The caller's `member` row in this org — the item's reporter. */
async function callerMemberId(organizationId: string, userId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Refuses a type change that would leave existing children illegally nested. */
async function assertNoChildConflict(parentId: string, newLevel: number) {
  const children = await db
    .select({
      level: workItemType.hierarchyLevel,
      strict: workItemType.strictHierarchy,
    })
    .from(workItem)
    .innerJoin(workItemType, eq(workItem.typeId, workItemType.id))
    .where(eq(workItem.parentId, parentId));

  // Each child answers for itself: a child whose type waives the level rule is
  // happy under the new type whatever its level.
  if (
    children.some((child) => !canParent(newLevel, child.level, child.strict))
  ) {
    throw new Error(
      "This item has children that would no longer fit under that type. Move them first.",
    );
  }
}

/**
 * One audit event aimed at a work item, trimmed to what the History section
 * renders. `actorName` is null once the actor's account is deleted (the audit
 * FK is ON DELETE SET NULL); the denormalized email survives as the fallback.
 */
export type WorkItemHistoryEntry = {
  id: string;
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

/** Items an epic or story can adopt — same project, lower hierarchy level. */
export type WorkItemDetail = {
  item: WorkItemRow;
  /** Everything the form needs to render its pickers, same as the list page. */
  types: WorkItemTypeRow[];
  fields: WorkItemFieldDefinition[];
  statuses: WorkflowStatusRow[];
  sprints: BacklogSprintRow[];
  members: BacklogMemberRow[];
  /** Sibling context the detail page shows but the form doesn't edit. */
  parent: {
    id: string;
    key: string;
    summary: string;
    typeId: string;
    statusId: string;
  } | null;
  children: {
    id: string;
    key: string;
    summary: string;
    statusId: string;
    typeId: string;
    /** The child's OWN estimate, so the hierarchy panel can show the split. */
    points: number | null;
  }[];
  /** Peer links: symmetric and separate from the parent/child tree. */
  relatedItems: {
    id: string;
    key: string;
    summary: string;
    statusId: string;
    typeId: string;
  }[];
  /**
   * What the item's estimate actually IS — `item.points` when someone typed
   * one, otherwise the sum rolled up from its children. Computed here because
   * this action already holds every row in the project; the page would
   * otherwise need the whole list client-side to derive one number.
   */
  estimate: EffectiveEstimate;
  reporterName: string | null;
  /**
   * Every item in the project, trimmed to what the parent picker needs. The
   * form re-filters this whenever the TYPE changes, so it can't be
   * pre-filtered here without breaking that.
   *
   * `parentId` rides along for the hierarchy panel: linking an item that
   * already sits under something MOVES it, and the picker has to be able to say
   * so before the click rather than after.
   */
  siblings: {
    id: string;
    key: string;
    summary: string;
    typeId: string;
    parentId: string | null;
  }[];
  /** Every distinct label already used in the project, for the labels picker. */
  projectLabels: string[];
  /** Newest-first audit events for this item, capped at HISTORY_LIMIT. */
  history: WorkItemHistoryEntry[];
  /** The item's files, plus what the caller may do with them. */
  attachments: WorkItemAttachmentPayload;
};

/**
 * Enough that a normal item's whole life fits; a cap at all because the audit
 * trail is unbounded and this renders on every detail page load.
 */
const HISTORY_LIMIT = 50;

/**
 * One item, by its human key (PROJ-123). The detail ROUTE reads this rather
 * than picking a row out of the backlog list, so the page is directly
 * linkable — a teammate pasting a URL must not depend on the list being
 * loaded, and a bookmark has to survive the item leaving the default filters.
 */
export async function getWorkItemDetail(input: {
  organizationId: string;
  projectId: string;
  number: number;
}): Promise<WorkItemDetail | null> {
  const session = await requireProjectPermission(
    input.organizationId,
    input.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );
  await ensureOrganizationWorkItemTypes(input.organizationId);
  await ensureProjectWorkflowStatuses(input.projectId);

  const [items, types, statuses, sprints, members, fields] = await Promise.all([
    listWorkItems(input.projectId),
    listWorkItemTypes(input.organizationId),
    listWorkflowStatuses(input.projectId),
    listBacklogSprints(input.projectId),
    listProjectMembers(input.projectId),
    listWorkItemFields(input.organizationId),
  ]);

  const item = items.find((row) => row.number === input.number);
  if (!item) return null;

  const parentRow = item.parentId
    ? (items.find((row) => row.id === item.parentId) ?? null)
    : null;

  const [[reporter], history, attachments, links] = await Promise.all([
    item.reporterMemberId
      ? db
          .select({ name: user.name })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(eq(member.id, item.reporterMemberId))
          .limit(1)
      : Promise.resolve([] as { name: string }[]),
    // The org filter is redundant with the target pair but keeps this read
    // inside the caller's already-authorized scope even if a target id ever
    // collides across orgs.
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorName: user.name,
        actorEmail: auditLog.actorEmail,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.actorId, user.id))
      .where(
        and(
          eq(auditLog.organizationId, input.organizationId),
          eq(auditLog.targetType, "workItem"),
          eq(auditLog.targetId, item.id),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(HISTORY_LIMIT),
    loadAttachmentPayload({
      workItemId: item.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: session.user.id,
    }),
    db
      .select({
        sourceWorkItemId: workItemLink.sourceWorkItemId,
        targetWorkItemId: workItemLink.targetWorkItemId,
      })
      .from(workItemLink)
      .where(
        or(
          eq(workItemLink.sourceWorkItemId, item.id),
          eq(workItemLink.targetWorkItemId, item.id),
        ),
      ),
  ]);

  const itemsById = new Map(items.map((row) => [row.id, row]));
  const relatedItems = links
    .map((link) =>
      link.sourceWorkItemId === item.id
        ? link.targetWorkItemId
        : link.sourceWorkItemId,
    )
    .map((relatedItemId) => itemsById.get(relatedItemId))
    .filter((row): row is WorkItemRow => row !== undefined)
    .map((row) => ({
      id: row.id,
      key: row.key,
      summary: row.summary,
      statusId: row.statusId,
      typeId: row.typeId,
    }));

  return {
    item,
    types,
    fields,
    statuses,
    sprints,
    members,
    parent: parentRow
      ? {
          id: parentRow.id,
          key: parentRow.key,
          summary: parentRow.summary,
          typeId: parentRow.typeId,
          statusId: parentRow.statusId,
        }
      : null,
    children: items
      .filter((row) => row.parentId === item.id)
      .map((row) => ({
        id: row.id,
        key: row.key,
        summary: row.summary,
        statusId: row.statusId,
        typeId: row.typeId,
        points: row.points,
      })),
    relatedItems,
    estimate: effectiveEstimateOf(item.id, items),
    reporterName: reporter?.name ?? null,
    siblings: items.map((row) => ({
      id: row.id,
      key: row.key,
      summary: row.summary,
      typeId: row.typeId,
      parentId: row.parentId,
    })),
    projectLabels: distinctLabels(items),
    history,
    attachments,
  };
}

/**
 * The attachment half of the detail payload: the list plus what this caller may
 * do with it, resolved on the server so the tab never has to guess and the
 * first paint already has the files.
 */
async function loadAttachmentPayload(input: {
  workItemId: string;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<WorkItemAttachmentPayload> {
  const [attachments, viewerMemberId, bypass] = await Promise.all([
    listWorkItemAttachments(input.workItemId, input.organizationId),
    callerMemberId(input.organizationId, input.userId),
    hasOrgPermission(input.organizationId, ORG_BYPASS),
  ]);
  const abilities = await callerAttachmentAbilities(
    input.organizationId,
    input.projectId,
    input.userId,
    bypass,
  );
  return {
    workItemId: input.workItemId,
    attachments,
    viewerMemberId,
    ...abilities,
  };
}

/** The de-duplicated, sorted union of every label used across `items`. */
function distinctLabels(items: { labels: string[] }[]): string[] {
  return Array.from(new Set(items.flatMap((row) => row.labels))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export async function getParentCandidates(input: {
  organizationId: string;
  projectId: string;
  hierarchyLevel: number;
  /** The child type's `strictHierarchy`; off, every item is a candidate. */
  strictHierarchy: boolean;
  excludeId?: string;
}): Promise<{ id: string; key: string; summary: string }[]> {
  await requireProjectPermission(
    input.organizationId,
    input.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  const project = await loadProjectOrThrow(input.projectId);
  // The same level rule assertParentAllowed enforces on write, so the picker
  // can't offer a choice the action will refuse: strictly above the child's
  // level, or unconstrained when the child's type waives it. Cycles are caught
  // there, not here.
  const rows = await db
    .select({
      id: workItem.id,
      number: workItem.number,
      summary: workItem.summary,
    })
    .from(workItem)
    .innerJoin(workItemType, eq(workItem.typeId, workItemType.id))
    .where(
      and(
        eq(workItem.projectId, input.projectId),
        input.strictHierarchy
          ? lt(workItemType.hierarchyLevel, input.hierarchyLevel)
          : undefined,
        input.excludeId ? ne(workItem.id, input.excludeId) : undefined,
      ),
    )
    .orderBy(asc(workItemType.hierarchyLevel), asc(workItem.rank))
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    key: workItemKey(project.key, row.number),
    summary: row.summary,
  }));
}

/** Bulk sprint assignment from the backlog's multi-select. */
export async function setWorkItemsSprint(input: {
  workItemIds: string[];
  sprintId: string | null;
}) {
  if (input.workItemIds.length === 0) return;
  const first = await loadWorkItemOrThrow(input.workItemIds[0]);
  const session = await requireProjectPermission(
    first.organizationId,
    first.projectId,
    "backlog:prioritize",
    ORG_BYPASS,
    "You don't have permission to reorder this backlog.",
  );
  if (input.sprintId) {
    await assertSprintInProject(input.sprintId, first.projectId);
  }

  // Scoped to the project resolved from the first row: a mixed-project batch
  // would otherwise move items the caller was never authorized for.
  await db
    .update(workItem)
    .set({ sprintId: input.sprintId })
    .where(
      and(
        eq(workItem.projectId, first.projectId),
        inArray(workItem.id, input.workItemIds),
      ),
    );

  await refreshProjectCommittedPoints(first.projectId);

  await recordAudit({
    action: "workItem.bulkScheduled",
    organizationId: first.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: first.projectId,
    metadata: { sprintId: input.sprintId, count: input.workItemIds.length },
  });
  revalidateBacklog(first.projectId);
}
