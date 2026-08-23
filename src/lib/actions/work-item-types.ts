"use server";

import { and, asc, count, eq, gte, lte, max, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { user, workItem, workItemType } from "@/db/schema";
import type { WorkItemTone } from "@/db/schema/work-items";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import { mcpActor } from "@/lib/mcp/context";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import { hasOrgPermission, isUniqueViolation } from "@/lib/project-access";
import { hasAdminRole } from "@/lib/roles";
import { requireAuth } from "@/lib/session";
import {
  createWorkItemTypeSchema,
  updateWorkItemTypeSchema,
  workItemTypeIdSchema,
} from "@/lib/validation/work-items";
import { ensureOrganizationWorkItemTypes } from "@/lib/work-item-seed";
import { slugifyTypeKey, type WorkItemIconName } from "@/lib/work-items";

// The organization's work item vocabulary. Org-level configuration, so the gate
// is the Better Auth org permission (owner/admin), not a project role — a type
// is shared by every project in the org and one project's lead shouldn't be
// able to redefine what "Story" means everywhere.

async function requireTypeAdmin(organizationId: string) {
  const actor = mcpActor();
  const apiUser = actor
    ? await db.query.user.findFirst({ where: eq(user.id, actor.userId) })
    : null;
  const session = apiUser
    ? ({ user: apiUser } as Awaited<ReturnType<typeof requireAuth>>)
    : await requireAuth();
  // A platform admin is not a member of the organization, so the Better Auth
  // org permission check would refuse them — but /admin/organizations/[id]
  // edits this same catalog. Same branch as requireFieldAdmin.
  if (hasAdminRole(session.user.role)) return session;

  const allowed = await hasOrgPermission(organizationId, {
    organization: ["update"],
  });
  if (!allowed) {
    throw new Error("You don't have permission to manage work item types.");
  }
  return session;
}

function revalidateTypes() {
  revalidatePath("/manage-org/[slug]/work-items", "page");
  revalidatePath("/admin/organizations/[id]/work-items", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog", "page");
  // The detail page's parent/child pickers read the same level rule.
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog/[itemKey]", "page");
}

export type ManagedWorkItemType = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  hierarchyLevel: number;
  strictHierarchy: boolean;
  tone: WorkItemTone;
  icon: string;
  isDefault: boolean;
  tracksDefect: boolean;
  position: number;
  source: "local" | "sap";
  itemCount: number;
};

export async function getWorkItemTypes(
  organizationId: string,
): Promise<ManagedWorkItemType[]> {
  await requireAuth();
  await ensureOrganizationWorkItemTypes(organizationId);

  const rows = await db
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
      source: workItemType.source,
    })
    .from(workItemType)
    .where(eq(workItemType.organizationId, organizationId))
    .orderBy(asc(workItemType.position), asc(workItemType.name));

  // How many items each type holds — the delete dialog needs it, and a type in
  // use is one an admin should think twice about.
  const usage = await db
    .select({ typeId: workItem.typeId, value: count() })
    .from(workItem)
    .where(eq(workItem.organizationId, organizationId))
    .groupBy(workItem.typeId);
  const usageByType = new Map(usage.map((row) => [row.typeId, row.value]));

  return rows.map((row) => ({
    ...row,
    itemCount: usageByType.get(row.id) ?? 0,
  }));
}

export async function createWorkItemType(input: {
  organizationId: string;
  name: string;
  description?: string;
  hierarchyLevel: number;
  strictHierarchy?: boolean;
  tone?: WorkItemTone;
  icon?: WorkItemIconName;
  isDefault?: boolean;
  tracksDefect?: boolean;
}) {
  const parsed = createWorkItemTypeSchema.parse(input);
  const session = await requireTypeAdmin(parsed.organizationId);
  await assertPlatformNotLocked();

  const key = slugifyTypeKey(parsed.name);
  if (!key) throw new Error("Give the type a name with letters or numbers.");

  const [positionRow] = await db
    .select({ value: max(workItemType.position) })
    .from(workItemType)
    .where(eq(workItemType.organizationId, parsed.organizationId));
  const lastPosition = positionRow?.value ?? -1;

  if (parsed.isDefault) await clearDefaultType(parsed.organizationId);

  const id = crypto.randomUUID();
  try {
    await db.insert(workItemType).values({
      id,
      organizationId: parsed.organizationId,
      key,
      name: parsed.name,
      description: parsed.description || null,
      hierarchyLevel: parsed.hierarchyLevel,
      strictHierarchy: parsed.strictHierarchy,
      tone: parsed.tone,
      icon: parsed.icon,
      isDefault: parsed.isDefault,
      tracksDefect: parsed.tracksDefect,
      position: lastPosition + 1,
      source: "local",
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`A work item type called ${parsed.name} already exists.`);
    }
    throw error;
  }

  await recordAudit({
    action: "workItemType.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItemType",
    targetId: id,
    metadata: { key, name: parsed.name, hierarchyLevel: parsed.hierarchyLevel },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(workItemType)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItemType.id, id));
    },
  });
  revalidateTypes();
}

export async function updateWorkItemType(input: {
  typeId: string;
  organizationId: string;
  name: string;
  description?: string;
  hierarchyLevel: number;
  strictHierarchy?: boolean;
  tone?: WorkItemTone;
  icon?: WorkItemIconName;
  isDefault?: boolean;
  tracksDefect?: boolean;
}) {
  const parsed = updateWorkItemTypeSchema.parse(input);
  const session = await requireTypeAdmin(parsed.organizationId);

  const [existing] = await db
    .select({
      id: workItemType.id,
      key: workItemType.key,
      hierarchyLevel: workItemType.hierarchyLevel,
      strictHierarchy: workItemType.strictHierarchy,
    })
    .from(workItemType)
    .where(
      and(
        eq(workItemType.id, parsed.typeId),
        eq(workItemType.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Work item type not found.");

  // Changing the level re-parents nothing, but it can invalidate links that
  // were legal before (an Epic demoted to Story still holding stories). Refuse
  // rather than silently orphan someone's tree.
  // Tightening the rule can invalidate links that were legal while it was off,
  // exactly as a level change can — so both trigger the same guard.
  if (
    existing.hierarchyLevel !== parsed.hierarchyLevel ||
    existing.strictHierarchy !== parsed.strictHierarchy
  ) {
    await assertLevelChangeSafe(
      parsed.typeId,
      parsed.hierarchyLevel,
      parsed.strictHierarchy,
    );
  }

  if (parsed.isDefault) {
    await clearDefaultType(parsed.organizationId, parsed.typeId);
  }

  try {
    await db
      .update(workItemType)
      .set({
        name: parsed.name,
        description: parsed.description || null,
        hierarchyLevel: parsed.hierarchyLevel,
        strictHierarchy: parsed.strictHierarchy,
        tone: parsed.tone,
        icon: parsed.icon,
        isDefault: parsed.isDefault,
        tracksDefect: parsed.tracksDefect,
      })
      .where(eq(workItemType.id, parsed.typeId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`A work item type called ${parsed.name} already exists.`);
    }
    throw error;
  }

  await recordAudit({
    action: "workItemType.updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItemType",
    targetId: parsed.typeId,
    metadata: { name: parsed.name, hierarchyLevel: parsed.hierarchyLevel },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(workItemType)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItemType.id, parsed.typeId));
    },
  });
  revalidateTypes();
}

export async function deleteWorkItemType(input: {
  organizationId: string;
  typeId: string;
}) {
  const parsed = workItemTypeIdSchema.parse(input);
  const session = await requireTypeAdmin(parsed.organizationId);

  const [existing] = await db
    .select({
      id: workItemType.id,
      name: workItemType.name,
      isDefault: workItemType.isDefault,
    })
    .from(workItemType)
    .where(
      and(
        eq(workItemType.id, parsed.typeId),
        eq(workItemType.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Work item type not found.");

  // workItem.typeId is ON DELETE RESTRICT: an item must always have a type, and
  // silently repointing thousands of items at another type is not a decision to
  // make on someone's behalf.
  const [{ value: inUse }] = await db
    .select({ value: count() })
    .from(workItem)
    .where(eq(workItem.typeId, parsed.typeId));
  if (inUse > 0) {
    throw new Error(
      `${existing.name} is used by ${inUse} work item${inUse === 1 ? "" : "s"}. Change their type first.`,
    );
  }
  if (existing.isDefault) {
    throw new Error("Make another type the default before deleting this one.");
  }

  await db.delete(workItemType).where(eq(workItemType.id, parsed.typeId));

  await recordAudit({
    action: "workItemType.deleted",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItemType",
    targetId: parsed.typeId,
    metadata: { name: existing.name },
  });
  revalidateTypes();
}

/** Drag-reorder of the type picker's order. Sends the full ordered id list. */
export async function reorderWorkItemTypes(input: {
  organizationId: string;
  typeIds: string[];
}) {
  const session = await requireTypeAdmin(input.organizationId);

  const rows = await db
    .select({ id: workItemType.id })
    .from(workItemType)
    .where(eq(workItemType.organizationId, input.organizationId));
  const owned = new Set(rows.map((row) => row.id));
  const ordered = input.typeIds.filter((id) => owned.has(id));

  await Promise.all(
    ordered.map((id, index) =>
      db
        .update(workItemType)
        .set({ position: index })
        .where(eq(workItemType.id, id)),
    ),
  );

  await recordAudit({
    action: "workItemType.reordered",
    organizationId: input.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: input.organizationId,
    metadata: { count: ordered.length },
  });
  revalidateTypes();
}

/**
 * One default per org is a partial unique index, so the old default has to be
 * cleared before the new one is written — the index would reject the overlap.
 */
async function clearDefaultType(organizationId: string, exceptId?: string) {
  await db
    .update(workItemType)
    .set({ isDefault: false })
    .where(
      and(
        eq(workItemType.organizationId, organizationId),
        eq(workItemType.isDefault, true),
        exceptId ? ne(workItemType.id, exceptId) : undefined,
      ),
    );
}

/**
 * A level change has to keep every existing link legal in both directions:
 * items of this type must still fit under their parents, and must still be
 * able to hold the children they already have.
 */
async function assertLevelChangeSafe(
  typeId: string,
  newLevel: number,
  newStrict: boolean,
) {
  const childItem = alias(workItem, "childItem");
  const childType = alias(workItemType, "childType");
  const parentItem = alias(workItem, "parentItem");
  const parentType = alias(workItemType, "parentType");

  // Both halves are the negation of canParent, and in both it is the CHILD's
  // type that decides — a child whose type waives the level rule is never in
  // the way. Below, the children have their own types (hence childType), while
  // the items in the second check ARE of this type, so the value being saved
  // answers for them.
  const [tooHighChild] = await db
    .select({ id: childItem.id })
    .from(workItem)
    .innerJoin(childItem, eq(childItem.parentId, workItem.id))
    .innerJoin(childType, eq(childItem.typeId, childType.id))
    .where(
      and(
        eq(workItem.typeId, typeId),
        eq(childType.strictHierarchy, true),
        lte(childType.hierarchyLevel, newLevel),
      ),
    )
    .limit(1);
  if (tooHighChild) {
    throw new Error(
      "Items of this type already hold children that wouldn't fit under the new level.",
    );
  }

  // Items of this type nest anywhere from here on, so nothing they already sit
  // under can be wrong.
  if (!newStrict) return;

  const [tooLowParent] = await db
    .select({ id: workItem.id })
    .from(workItem)
    .innerJoin(parentItem, eq(workItem.parentId, parentItem.id))
    .innerJoin(parentType, eq(parentItem.typeId, parentType.id))
    .where(
      and(
        eq(workItem.typeId, typeId),
        gte(parentType.hierarchyLevel, newLevel),
      ),
    )
    .limit(1);
  if (tooLowParent) {
    throw new Error(
      "Items of this type already sit under parents that wouldn't be above the new level.",
    );
  }
}
