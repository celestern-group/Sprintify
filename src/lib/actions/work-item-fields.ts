"use server";

import { and, asc, count, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  user,
  workItemField,
  workItemFieldValue,
  workItemType,
} from "@/db/schema";
import type {
  WorkItemFieldPlacement,
  WorkItemFieldType,
} from "@/db/schema/work-items";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import { mcpActor } from "@/lib/mcp/context";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import { hasOrgPermission, isUniqueViolation } from "@/lib/project-access";
import { hasAdminRole } from "@/lib/roles";
import { requireAuth } from "@/lib/session";
import {
  createWorkItemFieldSchema,
  reorderWorkItemFieldsSchema,
  updateWorkItemFieldSchema,
  workItemFieldIdSchema,
} from "@/lib/validation/work-items";
import {
  fieldNeedsOptions,
  slugifyFieldKey,
  type WorkItemFieldOption,
} from "@/lib/work-item-fields";

// The organization's custom field catalog.
//
// Two doors, one table: an org owner/admin manages their own organization's
// fields from /manage-org, and a PLATFORM admin manages any organization's from
// /admin/organizations/[id]. The platform admin is not a member of the org, so
// the Better Auth org permission check would refuse them — hence the explicit
// role branch below rather than a second set of actions.

async function requireFieldAdmin(organizationId: string) {
  const actor = mcpActor();
  const apiUser = actor
    ? await db.query.user.findFirst({ where: eq(user.id, actor.userId) })
    : null;
  const session = apiUser
    ? ({ user: apiUser } as Awaited<ReturnType<typeof requireAuth>>)
    : await requireAuth();
  if (hasAdminRole(session.user.role)) return session;

  const allowed = await hasOrgPermission(organizationId, {
    organization: ["update"],
  });
  if (!allowed) {
    throw new Error("You don't have permission to manage work item fields.");
  }
  return session;
}

function revalidateFields() {
  revalidatePath("/manage-org/[slug]/work-items", "page");
  revalidatePath("/admin/organizations/[id]/work-items", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog", "page");
}

export type ManagedWorkItemField = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  fieldType: WorkItemFieldType;
  options: WorkItemFieldOption[];
  appliesToTypeIds: string[];
  isRequired: boolean;
  helpText: string | null;
  placement: WorkItemFieldPlacement;
  position: number;
  /** How many items have a value for it — the delete dialog needs it. */
  valueCount: number;
};

export async function getWorkItemFields(
  organizationId: string,
): Promise<ManagedWorkItemField[]> {
  await requireAuth();

  const rows = await db
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

  if (rows.length === 0) return [];

  const usage = await db
    .select({ fieldId: workItemFieldValue.fieldId, value: count() })
    .from(workItemFieldValue)
    .innerJoin(workItemField, eq(workItemFieldValue.fieldId, workItemField.id))
    .where(eq(workItemField.organizationId, organizationId))
    .groupBy(workItemFieldValue.fieldId);
  const usageByField = new Map(usage.map((row) => [row.fieldId, row.value]));

  return rows.map((row) => ({
    ...row,
    valueCount: usageByField.get(row.id) ?? 0,
  }));
}

/** Types in the org can't be pinned to unless they belong to it. */
async function assertTypesInOrg(typeIds: string[], organizationId: string) {
  if (typeIds.length === 0) return;
  const rows = await db
    .select({ id: workItemType.id })
    .from(workItemType)
    .where(eq(workItemType.organizationId, organizationId));
  const owned = new Set(rows.map((row) => row.id));
  if (typeIds.some((id) => !owned.has(id))) {
    throw new Error("One of those work item types isn't in this organization.");
  }
}

function normalizeOptions(
  fieldType: WorkItemFieldType,
  options: WorkItemFieldOption[] | undefined,
): WorkItemFieldOption[] {
  if (!fieldNeedsOptions(fieldType)) return [];
  const cleaned = (options ?? [])
    .map((option) => ({
      value: option.value.trim() || slugifyFieldKey(option.label),
      label: option.label.trim(),
    }))
    .filter((option) => option.value && option.label);

  const seen = new Set<string>();
  const unique = cleaned.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });

  if (unique.length === 0) {
    throw new Error("A select field needs at least one option.");
  }
  return unique;
}

export async function createWorkItemField(input: {
  organizationId: string;
  label: string;
  description?: string;
  fieldType: WorkItemFieldType;
  options?: WorkItemFieldOption[];
  appliesToTypeIds?: string[];
  isRequired?: boolean;
  helpText?: string;
  placement?: WorkItemFieldPlacement;
}) {
  const parsed = createWorkItemFieldSchema.parse(input);
  const session = await requireFieldAdmin(parsed.organizationId);
  await assertPlatformNotLocked();

  const key = slugifyFieldKey(parsed.label);
  if (!key) throw new Error("Give the field a label with letters or numbers.");

  const options = normalizeOptions(parsed.fieldType, parsed.options);
  await assertTypesInOrg(parsed.appliesToTypeIds ?? [], parsed.organizationId);

  const [positionRow] = await db
    .select({ value: max(workItemField.position) })
    .from(workItemField)
    .where(eq(workItemField.organizationId, parsed.organizationId));

  const id = crypto.randomUUID();
  try {
    await db.insert(workItemField).values({
      id,
      organizationId: parsed.organizationId,
      key,
      label: parsed.label,
      description: parsed.description || null,
      fieldType: parsed.fieldType,
      options,
      appliesToTypeIds: parsed.appliesToTypeIds ?? [],
      isRequired: parsed.isRequired ?? false,
      helpText: parsed.helpText || null,
      placement: parsed.placement ?? "main",
      position: (positionRow?.value ?? -1) + 1,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`A field called ${parsed.label} already exists.`);
    }
    throw error;
  }

  await recordAudit({
    action: "workItemField.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItemField",
    targetId: id,
    metadata: {
      key,
      label: parsed.label,
      fieldType: parsed.fieldType,
      isRequired: parsed.isRequired ?? false,
      placement: parsed.placement ?? "main",
    },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.label, parsed.description, parsed.helpText),
    persist: async (result) => {
      await db
        .update(workItemField)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItemField.id, id));
    },
  });
  revalidateFields();
}

export async function updateWorkItemField(input: {
  fieldId: string;
  organizationId: string;
  label: string;
  description?: string;
  fieldType: WorkItemFieldType;
  options?: WorkItemFieldOption[];
  appliesToTypeIds?: string[];
  isRequired?: boolean;
  helpText?: string;
  placement?: WorkItemFieldPlacement;
}) {
  const parsed = updateWorkItemFieldSchema.parse(input);
  const session = await requireFieldAdmin(parsed.organizationId);

  const [existing] = await db
    .select({
      id: workItemField.id,
      fieldType: workItemField.fieldType,
    })
    .from(workItemField)
    .where(
      and(
        eq(workItemField.id, parsed.fieldId),
        eq(workItemField.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Field not found.");

  // Changing the type would reinterpret every stored value as something it
  // isn't (a "3" that meant an option id becoming the number three). Refuse
  // once anything is stored; the field can still be deleted and recreated.
  if (existing.fieldType !== parsed.fieldType) {
    const [{ value: stored }] = await db
      .select({ value: count() })
      .from(workItemFieldValue)
      .where(eq(workItemFieldValue.fieldId, parsed.fieldId));
    if (stored > 0) {
      throw new Error(
        `This field already holds ${stored} value${stored === 1 ? "" : "s"}, so its type can't change. Create a new field instead.`,
      );
    }
  }

  const options = normalizeOptions(parsed.fieldType, parsed.options);
  await assertTypesInOrg(parsed.appliesToTypeIds ?? [], parsed.organizationId);

  try {
    await db
      .update(workItemField)
      .set({
        label: parsed.label,
        description: parsed.description || null,
        fieldType: parsed.fieldType,
        options,
        appliesToTypeIds: parsed.appliesToTypeIds ?? [],
        isRequired: parsed.isRequired ?? false,
        helpText: parsed.helpText || null,
        placement: parsed.placement ?? "main",
      })
      .where(eq(workItemField.id, parsed.fieldId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`A field called ${parsed.label} already exists.`);
    }
    throw error;
  }

  await recordAudit({
    action: "workItemField.updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItemField",
    targetId: parsed.fieldId,
    metadata: {
      label: parsed.label,
      fieldType: parsed.fieldType,
      isRequired: parsed.isRequired ?? false,
      placement: parsed.placement ?? "main",
    },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.label, parsed.description, parsed.helpText),
    persist: async (result) => {
      await db
        .update(workItemField)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItemField.id, parsed.fieldId));
    },
  });
  revalidateFields();
}

export async function deleteWorkItemField(input: {
  organizationId: string;
  fieldId: string;
}) {
  const parsed = workItemFieldIdSchema.parse(input);
  const session = await requireFieldAdmin(parsed.organizationId);

  const [existing] = await db
    .select({ id: workItemField.id, label: workItemField.label })
    .from(workItemField)
    .where(
      and(
        eq(workItemField.id, parsed.fieldId),
        eq(workItemField.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Field not found.");

  const [{ value: stored }] = await db
    .select({ value: count() })
    .from(workItemFieldValue)
    .where(eq(workItemFieldValue.fieldId, parsed.fieldId));

  // Values cascade with the definition — a value whose field is gone can't be
  // rendered or explained. Destructive, so the count goes in the audit row and
  // the confirm dialog says it out loud.
  await db.delete(workItemField).where(eq(workItemField.id, parsed.fieldId));

  await recordAudit({
    action: "workItemField.deleted",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItemField",
    targetId: parsed.fieldId,
    metadata: { label: existing.label, discardedValues: stored },
  });
  revalidateFields();
}

/** The order fields appear in on the item form. Full ordered id list. */
export async function reorderWorkItemFields(input: {
  organizationId: string;
  fieldIds: string[];
}) {
  const parsed = reorderWorkItemFieldsSchema.parse(input);
  const session = await requireFieldAdmin(parsed.organizationId);

  const rows = await db
    .select({ id: workItemField.id })
    .from(workItemField)
    .where(eq(workItemField.organizationId, parsed.organizationId));
  const owned = new Set(rows.map((row) => row.id));
  const ordered = parsed.fieldIds.filter((id) => owned.has(id));

  await Promise.all(
    ordered.map((id, index) =>
      db
        .update(workItemField)
        .set({ position: index })
        .where(eq(workItemField.id, id)),
    ),
  );

  await recordAudit({
    action: "workItemField.reordered",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: parsed.organizationId,
    metadata: { count: ordered.length },
  });
  revalidateFields();
}
