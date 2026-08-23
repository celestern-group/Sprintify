import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  workItem,
  workItemAttachment,
  workItemField,
} from "@/db/schema";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { loadCallerProjectPermissions } from "@/lib/project-access";
import { projectRoleCan } from "@/lib/project-permissions";
import {
  attachmentUrl,
  isBuiltInAttachmentFieldKey,
  isInlineImage,
  MAX_ATTACHMENTS_PER_ITEM,
  WORK_ITEM_ATTACHMENT_FIELD_LABELS,
  type WorkItemAttachmentAbilities,
  type WorkItemAttachmentRow,
} from "@/lib/work-item-attachments";

// Shared loaders for the attachment route and the attachment actions.
//
// A plain module, not "use server": those may only export async functions, and
// every loader here takes an ATTACKER-CONTROLLED id. Same rule as
// work-item-access.ts — scope is derived from the STORED row (the attachment's
// own projectId/organizationId), never from what the client paired with it.

export type StoredAttachment = {
  id: string;
  organizationId: string;
  projectId: string;
  workItemId: string;
  fieldKey: string | null;
  storageKey: string;
  fileName: string;
  contentType: string;
  size: number;
  description: string | null;
  uploadedByMemberId: string | null;
  uploadedById: string | null;
};

export async function loadAttachmentOrThrow(
  attachmentId: string,
): Promise<StoredAttachment> {
  const [row] = await db
    .select({
      id: workItemAttachment.id,
      organizationId: workItemAttachment.organizationId,
      projectId: workItemAttachment.projectId,
      workItemId: workItemAttachment.workItemId,
      fieldKey: workItemAttachment.fieldKey,
      storageKey: workItemAttachment.storageKey,
      fileName: workItemAttachment.fileName,
      contentType: workItemAttachment.contentType,
      size: workItemAttachment.size,
      description: workItemAttachment.description,
      uploadedByMemberId: workItemAttachment.uploadedByMemberId,
      uploadedById: workItemAttachment.uploadedById,
    })
    .from(workItemAttachment)
    .where(eq(workItemAttachment.id, attachmentId))
    .limit(1);
  if (!row) throw new Error("Attachment not found.");
  return row;
}

/** The caller's own member row in this org — the identity attachments anchor to. */
export async function callerMemberId(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * What the caller may do with this item's attachments. `canManage` is about
 * SOMEONE ELSE'S file — your own upload is authorship, which is why the row
 * comparison rather than a permission decides that (see canEditAttachment).
 */
export async function callerAttachmentAbilities(
  organizationId: string,
  projectId: string,
  userId: string,
  /** True when the caller is an org owner/admin, who bypasses project roles. */
  orgBypass: boolean,
): Promise<Omit<WorkItemAttachmentAbilities, "viewerMemberId">> {
  if (orgBypass) return { canUpload: true, canManage: true };
  const permissions = await loadCallerProjectPermissions(
    organizationId,
    projectId,
    userId,
  );
  return {
    canUpload: projectRoleCan(permissions, "attachment:create"),
    canManage: projectRoleCan(permissions, "attachment:manage"),
  };
}

/**
 * Human labels for the fields a set of attachments was dropped on. Built-ins
 * resolve from the catalog; the rest are custom-field ids, looked up once for
 * the whole list rather than per row. An id that no longer resolves (the field
 * was deleted after the drop) comes back null — the file is still the file.
 */
export async function resolveFieldLabels(
  organizationId: string,
  fieldKeys: (string | null)[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const custom: string[] = [];

  for (const key of fieldKeys) {
    if (!key || labels.has(key)) continue;
    if (isBuiltInAttachmentFieldKey(key)) {
      labels.set(key, WORK_ITEM_ATTACHMENT_FIELD_LABELS[key]);
    } else {
      custom.push(key);
    }
  }

  if (custom.length > 0) {
    const rows = await db
      .select({ id: workItemField.id, label: workItemField.label })
      .from(workItemField)
      .where(
        and(
          eq(workItemField.organizationId, organizationId),
          inArray(workItemField.id, custom),
        ),
      );
    for (const row of rows) labels.set(row.id, row.label);
  }

  return labels;
}

/**
 * A `fieldKey` the client sent, kept only when it names something real: a
 * built-in prose block, or a custom field belonging to THIS organization.
 * Anything else is dropped to null rather than rejected — the upload is what
 * the person asked for, and a stale field id must not lose them the file.
 */
export async function resolveFieldKey(
  organizationId: string,
  fieldKey: string | null,
): Promise<string | null> {
  if (!fieldKey) return null;
  if (isBuiltInAttachmentFieldKey(fieldKey)) return fieldKey;

  const [row] = await db
    .select({ id: workItemField.id })
    .from(workItemField)
    .where(
      and(
        eq(workItemField.organizationId, organizationId),
        eq(workItemField.id, fieldKey),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** One item's attachments, oldest first, shaped for every surface. */
export async function listWorkItemAttachments(
  workItemId: string,
  organizationId: string,
): Promise<WorkItemAttachmentRow[]> {
  const rows = await db
    .select({
      id: workItemAttachment.id,
      workItemId: workItemAttachment.workItemId,
      fieldKey: workItemAttachment.fieldKey,
      fileName: workItemAttachment.fileName,
      contentType: workItemAttachment.contentType,
      size: workItemAttachment.size,
      description: workItemAttachment.description,
      uploadedByMemberId: workItemAttachment.uploadedByMemberId,
      uploadedByName: workItemAttachment.uploadedByName,
      uploadedByEmail: workItemAttachment.uploadedByEmail,
      createdAt: workItemAttachment.createdAt,
    })
    .from(workItemAttachment)
    .where(eq(workItemAttachment.workItemId, workItemId))
    .orderBy(asc(workItemAttachment.createdAt));

  const labels = await resolveFieldLabels(
    organizationId,
    rows.map((row) => row.fieldKey),
  );

  return rows.map((row) => {
    const image = isInlineImage(row.contentType, row.fileName);
    return {
      ...row,
      fieldLabel: row.fieldKey ? (labels.get(row.fieldKey) ?? null) : null,
      url: attachmentUrl(row.workItemId, row.id),
      // Only offered when the route will actually serve it inline; a preview
      // link that 415s is worse than no preview link.
      previewUrl: image
        ? attachmentUrl(row.workItemId, row.id, { inline: true })
        : null,
      isImage: image,
    };
  });
}

/**
 * Refused because the item is full, or stopped existing while the bytes were
 * moving. Both are the caller's answer (409), not a fault — distinct from a
 * database failure, which must not be reported as "too many files".
 */
export class AttachmentRoomError extends Error {}

/**
 * Advisory pre-check: refuses an upload that ALREADY has no room, before 250 MB
 * of bytes are spent on it.
 *
 * Deliberately not the enforcement point — it counts outside any transaction,
 * so two concurrent uploads can both read the same free space. `insertAttachmentRows`
 * re-checks under a lock and is what actually holds the cap; this only exists so
 * the common case fails before the upload rather than after it.
 */
export async function assertAttachmentRoomLeft(
  workItemId: string,
  incoming: number,
): Promise<void> {
  const [row] = await db
    .select({ value: count() })
    .from(workItemAttachment)
    .where(eq(workItemAttachment.workItemId, workItemId));
  const existing = row?.value ?? 0;
  if (existing + incoming > MAX_ATTACHMENTS_PER_ITEM) {
    throw new AttachmentRoomError(
      `This item already has ${existing} attachments — the limit is ${MAX_ATTACHMENTS_PER_ITEM}.`,
    );
  }
}

/** One uploaded file's bytes, already in the store, waiting for its row. */
export type PendingAttachment = {
  id: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  size: number;
};

/**
 * Writes the registry rows for a batch of uploaded files, atomically with the
 * cap check.
 *
 * `FOR UPDATE` on the work item is what makes both halves safe, and it is the
 * SAME lock `deleteWorkItem` takes:
 *
 *   - Two concurrent uploads serialize on it, so they can't each see room for
 *     the last slot and both take it.
 *   - An upload that started before the item was deleted finds no row here and
 *     is refused, instead of inserting against a cascade that already ran (or
 *     landing in the window after `deleteWorkItem` read the storage keys, which
 *     would leave its bytes in the store with nothing pointing at them).
 *
 * The bytes are written before this, outside the transaction: a store round
 * trip has no business holding a row lock. That ordering means a refusal here
 * leaves objects behind, so the caller deletes them — see the route.
 */
export async function insertAttachmentRows(input: {
  workItemId: string;
  organizationId: string;
  projectId: string;
  fieldKey: string | null;
  uploadedByMemberId: string | null;
  uploadedById: string;
  uploadedByName: string;
  uploadedByEmail: string;
  files: PendingAttachment[];
}): Promise<void> {
  if (input.files.length === 0) return;

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: workItem.id })
      .from(workItem)
      .where(eq(workItem.id, input.workItemId))
      .for("update")
      .limit(1);
    if (!locked) {
      throw new AttachmentRoomError("That work item no longer exists.");
    }

    const [row] = await tx
      .select({ value: count() })
      .from(workItemAttachment)
      .where(eq(workItemAttachment.workItemId, input.workItemId));
    const existing = row?.value ?? 0;
    if (existing + input.files.length > MAX_ATTACHMENTS_PER_ITEM) {
      throw new AttachmentRoomError(
        `This item already has ${existing} attachments — the limit is ${MAX_ATTACHMENTS_PER_ITEM}.`,
      );
    }

    await tx.insert(workItemAttachment).values(
      input.files.map((file) => ({
        id: file.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        fieldKey: input.fieldKey,
        storageKey: file.storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        size: file.size,
        uploadedByMemberId: input.uploadedByMemberId,
        uploadedById: input.uploadedById,
        uploadedByName: input.uploadedByName,
        uploadedByEmail: input.uploadedByEmail,
      })),
    );
  });
}

/**
 * Embeds a file's name and caption, best-effort, post-response. Same contract
 * as every other prose surface: a missing AI config just leaves the columns
 * untouched.
 */
export function scheduleAttachmentEmbedding(input: {
  attachmentId: string;
  organizationId: string;
  fileName: string;
  description: string | null;
}): void {
  scheduleEmbedding({
    organizationId: input.organizationId,
    text: embeddingSource(input.fileName, input.description),
    persist: async ({ embedding, model }) => {
      await db
        .update(workItemAttachment)
        .set({
          embedding,
          embeddingModel: model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItemAttachment.id, input.attachmentId));
    },
  });
}
