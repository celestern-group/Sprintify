"use server";

import { and, asc, count, eq, max, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { workflowStatus, workItem } from "@/db/schema";
import type { WorkflowStatusCategory } from "@/db/schema/work-items";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import {
  isUniqueViolation,
  requireProjectPermission,
} from "@/lib/project-access";
import {
  createWorkflowStatusSchema,
  reorderWorkflowStatusesSchema,
  updateWorkflowStatusSchema,
  workflowStatusIdSchema,
} from "@/lib/validation/work-items";
import { loadProjectOrThrow } from "@/lib/work-item-access";
import { ensureProjectWorkflowStatuses } from "@/lib/work-item-seed";

// A project's flow — these rows are the board's columns. Project-scoped
// configuration, so the gate is the project role permission `role:manage`
// (whoever shapes a project's roles shapes its process), with the usual
// org owner/admin bypass.

const MANAGE_DENIED =
  "You don't have permission to change this project's flow.";
const ORG_BYPASS: Record<string, string[]> = { project: ["update"] };

function revalidateStatuses() {
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/settings", "page");
}

export type ManagedWorkflowStatus = {
  id: string;
  name: string;
  description: string | null;
  category: WorkflowStatusCategory;
  position: number;
  isDefault: boolean;
  wipLimit: number | null;
  itemCount: number;
};

export async function getWorkflowStatuses(input: {
  organizationId: string;
  projectId: string;
}): Promise<ManagedWorkflowStatus[]> {
  await requireProjectPermission(
    input.organizationId,
    input.projectId,
    "backlog:view",
    ORG_BYPASS,
    "You don't have permission to view this project's flow.",
  );
  await ensureProjectWorkflowStatuses(input.projectId);

  const rows = await db
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
    .where(eq(workflowStatus.projectId, input.projectId))
    .orderBy(asc(workflowStatus.position), asc(workflowStatus.name));

  const usage = await db
    .select({ statusId: workItem.statusId, value: count() })
    .from(workItem)
    .where(eq(workItem.projectId, input.projectId))
    .groupBy(workItem.statusId);
  const usageByStatus = new Map(usage.map((row) => [row.statusId, row.value]));

  return rows.map((row) => ({
    ...row,
    itemCount: usageByStatus.get(row.id) ?? 0,
  }));
}

export async function createWorkflowStatus(input: {
  projectId: string;
  name: string;
  description?: string;
  category: WorkflowStatusCategory;
  wipLimit?: number | null;
}) {
  const parsed = createWorkflowStatusSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  const session = await requireProjectPermission(
    project.organizationId,
    project.id,
    "role:manage",
    ORG_BYPASS,
    MANAGE_DENIED,
  );
  await assertPlatformNotLocked();

  const [positionRow] = await db
    .select({ value: max(workflowStatus.position) })
    .from(workflowStatus)
    .where(eq(workflowStatus.projectId, project.id));

  const id = crypto.randomUUID();
  try {
    await db.insert(workflowStatus).values({
      id,
      organizationId: project.organizationId,
      projectId: project.id,
      name: parsed.name,
      description: parsed.description || null,
      category: parsed.category,
      position: (positionRow?.value ?? -1) + 1,
      wipLimit: parsed.wipLimit ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`This project already has a "${parsed.name}" status.`);
    }
    throw error;
  }

  await recordAudit({
    action: "workflowStatus.created",
    organizationId: project.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workflowStatus",
    targetId: id,
    metadata: {
      projectId: project.id,
      name: parsed.name,
      category: parsed.category,
    },
  });
  scheduleEmbedding({
    organizationId: project.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(workflowStatus)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workflowStatus.id, id));
    },
  });
  revalidateStatuses();
}

export async function updateWorkflowStatus(input: {
  statusId: string;
  projectId: string;
  name: string;
  description?: string;
  category: WorkflowStatusCategory;
  wipLimit?: number | null;
  isDefault?: boolean;
}) {
  const parsed = updateWorkflowStatusSchema.parse(input);
  const existing = await loadStatusOrThrow(parsed.statusId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "role:manage",
    ORG_BYPASS,
    MANAGE_DENIED,
  );

  // One default per project is a partial unique index, so the old default has
  // to be cleared before the new one lands.
  if (parsed.isDefault) {
    await db
      .update(workflowStatus)
      .set({ isDefault: false })
      .where(
        and(
          eq(workflowStatus.projectId, existing.projectId),
          eq(workflowStatus.isDefault, true),
          ne(workflowStatus.id, existing.id),
        ),
      );
  }

  try {
    await db
      .update(workflowStatus)
      .set({
        name: parsed.name,
        description: parsed.description || null,
        category: parsed.category,
        wipLimit: parsed.wipLimit ?? null,
        isDefault: parsed.isDefault ?? existing.isDefault,
      })
      .where(eq(workflowStatus.id, existing.id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`This project already has a "${parsed.name}" status.`);
    }
    throw error;
  }

  await recordAudit({
    action: "workflowStatus.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workflowStatus",
    targetId: existing.id,
    metadata: {
      projectId: existing.projectId,
      name: parsed.name,
      category: parsed.category,
    },
  });
  scheduleEmbedding({
    organizationId: existing.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(workflowStatus)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workflowStatus.id, existing.id));
    },
  });
  revalidateStatuses();
}

export async function deleteWorkflowStatus(input: { statusId: string }) {
  const parsed = workflowStatusIdSchema.parse(input);
  const existing = await loadStatusOrThrow(parsed.statusId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "role:manage",
    ORG_BYPASS,
    MANAGE_DENIED,
  );

  // workItem.statusId is ON DELETE RESTRICT — an item always sits somewhere.
  const [{ value: inUse }] = await db
    .select({ value: count() })
    .from(workItem)
    .where(eq(workItem.statusId, existing.id));
  if (inUse > 0) {
    throw new Error(
      `${existing.name} still holds ${inUse} item${inUse === 1 ? "" : "s"}. Move them to another column first.`,
    );
  }
  if (existing.isDefault) {
    throw new Error(
      "Make another status the default before deleting this one.",
    );
  }
  const [{ value: remaining }] = await db
    .select({ value: count() })
    .from(workflowStatus)
    .where(eq(workflowStatus.projectId, existing.projectId));
  if (remaining <= 1) {
    throw new Error("A project needs at least one status.");
  }

  await db.delete(workflowStatus).where(eq(workflowStatus.id, existing.id));

  await recordAudit({
    action: "workflowStatus.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workflowStatus",
    targetId: existing.id,
    metadata: { projectId: existing.projectId, name: existing.name },
  });
  revalidateStatuses();
}

/** Column order on the board. Sends the full ordered id list. */
export async function reorderWorkflowStatuses(input: {
  projectId: string;
  statusIds: string[];
}) {
  const parsed = reorderWorkflowStatusesSchema.parse(input);
  const project = await loadProjectOrThrow(parsed.projectId);
  const session = await requireProjectPermission(
    project.organizationId,
    project.id,
    "role:manage",
    ORG_BYPASS,
    MANAGE_DENIED,
  );

  const rows = await db
    .select({ id: workflowStatus.id })
    .from(workflowStatus)
    .where(eq(workflowStatus.projectId, project.id));
  const owned = new Set(rows.map((row) => row.id));
  const ordered = parsed.statusIds.filter((id) => owned.has(id));

  await Promise.all(
    ordered.map((id, index) =>
      db
        .update(workflowStatus)
        .set({ position: index })
        .where(eq(workflowStatus.id, id)),
    ),
  );

  await recordAudit({
    action: "workflowStatus.reordered",
    organizationId: project.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: project.id,
    metadata: { count: ordered.length },
  });
  revalidateStatuses();
}

async function loadStatusOrThrow(statusId: string) {
  const [row] = await db
    .select({
      id: workflowStatus.id,
      organizationId: workflowStatus.organizationId,
      projectId: workflowStatus.projectId,
      name: workflowStatus.name,
      isDefault: workflowStatus.isDefault,
    })
    .from(workflowStatus)
    .where(eq(workflowStatus.id, statusId))
    .limit(1);
  if (!row) throw new Error("Status not found.");
  return row;
}
