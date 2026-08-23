"use server";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { workItem, workItemType } from "@/db/schema";
import type { WorkItemPriority } from "@/db/schema/work-items";
import type { AiTextOperation } from "@/lib/ai/assist-operations";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { medianPoints } from "@/lib/ai/estimate";
import {
  AiTextUnavailableError,
  generateObject,
  generateText,
} from "@/lib/ai/text";
import {
  acceptanceCriteriaPrompt,
  acceptanceCriteriaSchema,
  type ChildSuggestion,
  childSuggestionsSchema,
  DRAFT_SYSTEM,
  defectBreakdownPrompt,
  defectBreakdownSchema,
  draftPrompt,
  draftSchema,
  type ItemContext,
  PROSE_SYSTEM,
  rewritePrompt,
  SPLIT_SYSTEM,
  splitPrompt,
  type WorkItemDraft,
} from "@/lib/ai/work-item-prompts";
import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  type EstimateSuggestion,
  findSimilarWorkItems,
  type SimilarWorkItem,
} from "@/lib/ai/work-item-similarity";
import { recordAudit } from "@/lib/audit";
import { requireProjectPermission } from "@/lib/project-access";
import type { ProjectPermissionKey } from "@/lib/project-permissions";
import {
  assistFieldTextSchema,
  createChildWorkItemsSchema,
  deriveAcceptanceCriteriaSchema,
  deriveDefectFieldsSchema,
  draftWorkItemSchema,
  searchWorkItemsSchema,
  similarWorkItemsSchema,
  suggestChildWorkItemsSchema,
  suggestEstimateSchema,
} from "@/lib/validation/ai-assist";
import {
  type BacklogProject,
  loadProjectOrThrow,
  loadWorkItemOrThrow,
} from "@/lib/work-item-access";
import { createWorkItem } from "./work-items";

// The backlog's AI layer.
//
// Two rules run through every action here:
//
//  - Scope comes from the STORED row, exactly as in ./work-items.ts. An id the
//    client sent is resolved to its project, and the project to its
//    organization — which is also what decides whose AI provider and whose bill
//    the call lands on.
//  - AI being unavailable is an EXPECTED answer, not an exception. An org with
//    no provider configured, or a model that returns nonsense, comes back as
//    { ok: false, message } so the UI can explain it. Permission and validation
//    failures still throw, like everywhere else.

const ORG_BYPASS: Record<string, string[]> = { project: ["update"] };
const WRITE_DENIED =
  "You don't have permission to edit work items in this project.";
const VIEW_DENIED = "You don't have permission to view this project's backlog.";

export type AiFailure = { ok: false; message: string };
export type AiOk<T> = { ok: true } & T;
export type AiResult<T> = AiOk<T> | AiFailure;

/**
 * Turns the two "AI isn't usable right now" errors into a value. Anything else
 * — a permission denial, a validation error, a genuine bug — still throws.
 */
async function runAi<R extends { ok: boolean }>(
  work: () => Promise<R>,
): Promise<R | AiFailure> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof AiNotConfiguredError ||
      error instanceof AiTextUnavailableError
    ) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/**
 * Assisting on a field is a write-shaped act: it produces text meant to land in
 * the item, and it spends the organization's provider budget. Whoever may edit
 * items may use it — and on the create page, whoever may create them.
 */
async function requireItemWrite(project: BacklogProject) {
  const attempt = (permission: ProjectPermissionKey) =>
    requireProjectPermission(
      project.organizationId,
      project.id,
      permission,
      ORG_BYPASS,
      WRITE_DENIED,
    );
  try {
    return await attempt("item:update");
  } catch {
    // Not a swallowed failure: the second call re-runs the same session and
    // membership checks, so a caller who is unauthenticated or outside the org
    // still ends up with a thrown error — just from the create branch.
    return await attempt("item:create");
  }
}

/** The item's own caption, so a rewrite knows what it is rewriting for. */
async function itemContext(
  workItemId: string | null | undefined,
  organizationId: string,
): Promise<ItemContext | undefined> {
  if (!workItemId) return undefined;
  const [row] = await db
    .select({
      summary: workItem.summary,
      typeName: workItemType.name,
      organizationId: workItem.organizationId,
    })
    .from(workItem)
    .innerJoin(workItemType, eq(workItem.typeId, workItemType.id))
    .where(eq(workItem.id, workItemId))
    .limit(1);
  // An id from another organization is context we simply don't add, rather
  // than an error — it can't leak, because it never reaches the prompt.
  if (!row || row.organizationId !== organizationId) return undefined;
  return { summary: row.summary, typeName: row.typeName };
}

// --- Field-level rewriting -------------------------------------------------

export async function assistFieldText(input: {
  projectId: string;
  workItemId?: string | null;
  fieldLabel: string;
  operation: AiTextOperation;
  text: string;
  instruction?: string | null;
  context?: { summary?: string; typeName?: string };
}): Promise<AiResult<{ text: string }>> {
  const parsed = assistFieldTextSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  const session = await requireItemWrite(project);

  return runAi(async () => {
    // The stored row wins where there is one; the form's own unsaved values are
    // the fallback, which is all the create page has.
    const context =
      (await itemContext(parsed.workItemId, project.organizationId)) ??
      parsed.context;
    const text = await generateText({
      organizationId: project.organizationId,
      system: PROSE_SYSTEM,
      prompt: rewritePrompt({
        fieldLabel: parsed.fieldLabel,
        text: parsed.text,
        operation: parsed.operation,
        instruction: parsed.instruction,
        context,
      }),
      // Room to grow: "add detail" on a full field legitimately doubles it.
      maxTokens: 3000,
    });

    await recordAudit({
      action: "workItem.aiRewritten",
      organizationId: project.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: parsed.workItemId ?? null,
      // The prose itself is deliberately not stored: the audit log records that
      // AI touched a field, not a second copy of the field.
      metadata: {
        projectId: project.id,
        field: parsed.fieldLabel,
        operation: parsed.operation,
        inputChars: parsed.text.length,
        outputChars: text.length,
      },
    });

    return { ok: true as const, text };
  });
}

// --- Cross-field structure -------------------------------------------------

export async function deriveAcceptanceCriteria(input: {
  projectId: string;
  workItemId?: string | null;
  summary: string;
  description: string;
  existing?: string | null;
}): Promise<AiResult<{ acceptanceCriteria: string }>> {
  const parsed = deriveAcceptanceCriteriaSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  const session = await requireItemWrite(project);

  return runAi(async () => {
    const context = await itemContext(
      parsed.workItemId,
      project.organizationId,
    );
    const result = await generateObject({
      organizationId: project.organizationId,
      system: PROSE_SYSTEM,
      prompt: acceptanceCriteriaPrompt({
        summary: parsed.summary,
        description: parsed.description,
        existing: parsed.existing,
        context,
      }),
      schema: acceptanceCriteriaSchema,
      maxTokens: 2000,
    });

    await recordAudit({
      action: "workItem.aiCriteriaSuggested",
      organizationId: project.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: parsed.workItemId ?? null,
      metadata: { projectId: project.id, summary: parsed.summary },
    });

    return { ok: true as const, ...result };
  });
}

export async function deriveDefectFields(input: {
  projectId: string;
  workItemId?: string | null;
  summary: string;
  report: string;
}): Promise<
  AiResult<{
    stepsToReproduce: string;
    expectedResult: string;
    actualResult: string;
  }>
> {
  const parsed = deriveDefectFieldsSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  const session = await requireItemWrite(project);

  return runAi(async () => {
    const context = await itemContext(
      parsed.workItemId,
      project.organizationId,
    );
    const result = await generateObject({
      organizationId: project.organizationId,
      system: PROSE_SYSTEM,
      prompt: defectBreakdownPrompt({
        summary: parsed.summary,
        report: parsed.report,
        context,
      }),
      schema: defectBreakdownSchema,
      maxTokens: 2000,
    });

    await recordAudit({
      action: "workItem.aiDefectSplit",
      organizationId: project.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: parsed.workItemId ?? null,
      metadata: { projectId: project.id },
    });

    return { ok: true as const, ...result };
  });
}

// --- Drafting a whole item -------------------------------------------------

export type DraftedWorkItem = Omit<WorkItemDraft, "typeName" | "priority"> & {
  /** Resolved against the org's own catalog — never a name the model invented. */
  typeId: string | null;
  priority: WorkItemPriority | null;
};

export async function draftWorkItem(input: {
  projectId: string;
  request: string;
}): Promise<AiResult<{ draft: DraftedWorkItem }>> {
  const parsed = draftWorkItemSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  const session = await requireItemWrite(project);

  const types = await db
    .select({
      id: workItemType.id,
      name: workItemType.name,
      hierarchyLevel: workItemType.hierarchyLevel,
    })
    .from(workItemType)
    .where(eq(workItemType.organizationId, project.organizationId))
    .orderBy(asc(workItemType.position));
  if (types.length === 0) {
    return { ok: false, message: "This organization has no work item types." };
  }

  return runAi(async () => {
    const generated = await generateObject({
      organizationId: project.organizationId,
      system: DRAFT_SYSTEM,
      prompt: draftPrompt({
        request: parsed.request,
        typeNames: types.map((type) => type.name),
      }),
      schema: draftSchema,
      maxTokens: 2500,
    });

    // The model names a type; the id is looked up here. A name it made up
    // simply resolves to null and the form keeps its own default.
    const matched = types.find(
      (type) =>
        type.name.toLowerCase() === generated.typeName?.trim().toLowerCase(),
    );

    await recordAudit({
      action: "workItem.aiDrafted",
      organizationId: project.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "project",
      targetId: project.id,
      metadata: { request: parsed.request.slice(0, 500) },
    });

    return {
      ok: true as const,
      draft: {
        summary: generated.summary,
        description: generated.description,
        acceptanceCriteria: generated.acceptanceCriteria,
        technicalNotes: generated.technicalNotes,
        labels: generated.labels,
        typeId: matched?.id ?? null,
        priority: generated.priority ?? null,
      },
    };
  });
}

// --- Breaking an item down -------------------------------------------------

export type ChildTypeOption = { id: string; name: string };

export async function suggestChildWorkItems(input: {
  workItemId: string;
}): Promise<
  AiResult<{ items: ChildSuggestion[]; childType: ChildTypeOption }>
> {
  const parsed = suggestChildWorkItemsSchema.parse(input);
  const stored = await loadWorkItemOrThrow(parsed.workItemId);
  const project = await loadProjectOrThrow(stored.projectId);
  const session = await requireItemWrite(project);

  const [parentType] = await db
    .select({
      hierarchyLevel: workItemType.hierarchyLevel,
      name: workItemType.name,
    })
    .from(workItemType)
    .where(eq(workItemType.id, stored.typeId))
    .limit(1);
  if (!parentType) return { ok: false, message: "That item has no type." };

  const childType = await resolveChildType(
    project.organizationId,
    parentType.hierarchyLevel,
  );
  if (!childType) {
    return {
      ok: false,
      message: `Nothing sits below ${parentType.name} in this organization's hierarchy, so it can't be broken down.`,
    };
  }

  const [body] = await db
    .select({
      description: workItem.description,
      acceptanceCriteria: workItem.acceptanceCriteria,
      technicalNotes: workItem.technicalNotes,
    })
    .from(workItem)
    .where(eq(workItem.id, stored.id))
    .limit(1);

  const existingChildren = await db
    .select({ summary: workItem.summary })
    .from(workItem)
    .where(eq(workItem.parentId, stored.id))
    .orderBy(asc(workItem.rank))
    .limit(50);

  return runAi(async () => {
    const result = await generateObject({
      organizationId: project.organizationId,
      system: SPLIT_SYSTEM,
      prompt: splitPrompt({
        summary: stored.summary,
        body: [
          body?.description,
          body?.acceptanceCriteria,
          body?.technicalNotes,
        ]
          .filter(Boolean)
          .join("\n\n"),
        childTypeName: childType.name,
        estimateUnit: project.capacityUnit,
        existingChildren: existingChildren.map((child) => child.summary),
      }),
      schema: childSuggestionsSchema,
      maxTokens: 3000,
    });

    await recordAudit({
      action: "workItem.aiChildrenSuggested",
      organizationId: project.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: stored.id,
      metadata: { count: result.items.length, childTypeId: childType.id },
    });

    return { ok: true as const, items: result.items, childType };
  });
}

/** The nearest type strictly below the parent's level — its default, else its first. */
async function resolveChildType(
  organizationId: string,
  parentLevel: number,
): Promise<ChildTypeOption | null> {
  const rows = await db
    .select({
      id: workItemType.id,
      name: workItemType.name,
      hierarchyLevel: workItemType.hierarchyLevel,
      isDefault: workItemType.isDefault,
    })
    .from(workItemType)
    .where(eq(workItemType.organizationId, organizationId))
    .orderBy(asc(workItemType.hierarchyLevel), asc(workItemType.position));

  const below = rows.filter((row) => row.hierarchyLevel > parentLevel);
  if (below.length === 0) return null;
  const topLevel = below[0].hierarchyLevel;
  const sameLevel = below.filter((row) => row.hierarchyLevel === topLevel);
  const chosen = sameLevel.find((row) => row.isDefault) ?? sameLevel[0];
  return { id: chosen.id, name: chosen.name };
}

/**
 * Creates the suggestions the user kept. Each row goes through createWorkItem
 * rather than a bulk insert — that is where the parent, type, number, rank,
 * audit and embedding rules live, and a "bulk" path would be a second copy of
 * all of them that could drift.
 */
export async function createChildWorkItems(input: {
  parentId: string;
  items: Array<{
    summary: string;
    description?: string;
    acceptanceCriteria?: string;
    points?: number | null;
  }>;
  typeId?: string | null;
  labels?: string[];
  priority?: WorkItemPriority;
}): Promise<{ created: Array<{ id: string; key: string }> }> {
  const parsed = createChildWorkItemsSchema.parse(input);
  const stored = await loadWorkItemOrThrow(parsed.parentId);
  const project = await loadProjectOrThrow(stored.projectId);

  const [parentType] = await db
    .select({ hierarchyLevel: workItemType.hierarchyLevel })
    .from(workItemType)
    .where(eq(workItemType.id, stored.typeId))
    .limit(1);
  if (!parentType) throw new Error("That item has no type.");

  const typeId =
    parsed.typeId ??
    (await resolveChildType(project.organizationId, parentType.hierarchyLevel))
      ?.id;
  if (!typeId) {
    throw new Error("There's no type below this item's own in the hierarchy.");
  }

  const created: Array<{ id: string; key: string }> = [];
  for (const item of parsed.items) {
    // Sequential on purpose: the item number and rank are both read-then-write,
    // and firing twelve of them at once would spend the retry budget on
    // collisions with each other.
    created.push(
      await createWorkItem({
        projectId: project.id,
        typeId,
        parentId: stored.id,
        sprintId: null,
        summary: item.summary,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        points: item.points ?? null,
        labels: parsed.labels,
        priority: parsed.priority,
      }),
    );
  }

  await recordAudit({
    action: "workItem.aiChildrenCreated",
    organizationId: project.organizationId,
    targetType: "workItem",
    targetId: stored.id,
    metadata: { count: created.length, keys: created.map((row) => row.key) },
  });

  return { created };
}

// --- Embedding-backed reads ------------------------------------------------

const NO_EMBEDDINGS =
  "Semantic search needs an embedding model. Pick one in AI settings, then run the embedding backfill.";

export async function findDuplicateWorkItems(input: {
  projectId: string;
  text: string;
  excludeWorkItemId?: string | null;
}): Promise<AiResult<{ items: SimilarWorkItem[] }>> {
  const parsed = similarWorkItemsSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  await requireProjectPermission(
    project.organizationId,
    project.id,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  return runAi(async () => {
    const items = await findSimilarWorkItems({
      organizationId: project.organizationId,
      projectId: project.id,
      text: parsed.text,
      excludeWorkItemId: parsed.excludeWorkItemId,
      minSimilarity: DUPLICATE_SIMILARITY_THRESHOLD,
      limit: 5,
    });
    if (!items) return { ok: false as const, message: NO_EMBEDDINGS };
    return { ok: true as const, items };
  });
}

export async function searchWorkItemsByMeaning(input: {
  projectId: string;
  query: string;
}): Promise<AiResult<{ items: SimilarWorkItem[] }>> {
  const parsed = searchWorkItemsSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  await requireProjectPermission(
    project.organizationId,
    project.id,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  return runAi(async () => {
    const items = await findSimilarWorkItems({
      organizationId: project.organizationId,
      projectId: project.id,
      text: parsed.query,
      // No floor: a search always answers with its best matches, ranked, and
      // lets the reader judge. A duplicate warning is the opposite — it only
      // earns the interruption above the threshold.
      limit: 20,
    });
    if (!items) return { ok: false as const, message: NO_EMBEDDINGS };
    return { ok: true as const, items };
  });
}

export async function suggestWorkItemEstimate(input: {
  projectId: string;
  workItemId?: string | null;
  text: string;
}): Promise<AiResult<{ suggestion: EstimateSuggestion | null }>> {
  const parsed = suggestEstimateSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  await requireItemWrite(project);

  return runAi(async () => {
    const neighbours = await findSimilarWorkItems({
      organizationId: project.organizationId,
      projectId: project.id,
      text: parsed.text,
      excludeWorkItemId: parsed.workItemId,
      completedOnly: true,
      limit: 8,
    });
    if (!neighbours) return { ok: false as const, message: NO_EMBEDDINGS };

    // Estimated AND finished: an unestimated item tells us nothing, and an
    // unfinished one hasn't proved its estimate yet.
    const estimated = neighbours.filter(
      (row): row is SimilarWorkItem & { points: number } => row.points !== null,
    );
    const points = medianPoints(estimated.map((row) => row.points));
    return {
      ok: true as const,
      suggestion: points === null ? null : { points, basis: estimated },
    };
  });
}
