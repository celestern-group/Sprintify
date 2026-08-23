"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { workItemAttachment } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import {
  hasOrgPermission,
  requireProjectPermission,
} from "@/lib/project-access";
import { storage } from "@/lib/storage";
import { sanitizeFileName } from "@/lib/storage/uploads";
import {
  deleteWorkItemAttachmentSchema,
  listWorkItemAttachmentsSchema,
  updateWorkItemAttachmentSchema,
} from "@/lib/validation/work-item-attachments";
import { loadWorkItemOrThrow } from "@/lib/work-item-access";
import {
  callerAttachmentAbilities,
  callerMemberId,
  listWorkItemAttachments,
  loadAttachmentOrThrow,
  scheduleAttachmentEmbedding,
} from "@/lib/work-item-attachment-access";
import {
  canEditAttachment,
  type WorkItemAttachmentPayload,
} from "@/lib/work-item-attachments";
import { workItemKey } from "@/lib/work-items";

// The read and manage paths for work-item attachments.
//
// Uploading is NOT here: a multipart body is far larger than the server-action
// body limit, so the write lives in a route handler
// (src/app/api/work-items/[workItemId]/attachments/route.ts), which is also the
// only place that touches the object store on the way in.
//
// Authorization mirrors the rest of the backlog layer: requireProjectPermission
// against the project resolved from the STORED row, with an org-admin bypass.
// Reading needs backlog:view (see the item, see its files); adding needs
// attachment:create; renaming or removing SOMEONE ELSE'S needs
// attachment:manage — your own is authorship, not a permission.

const VIEW_DENIED = "You don't have permission to view this project's backlog.";
const ORG_BYPASS: Record<string, string[]> = { project: ["update"] };

function revalidateItem() {
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog/[itemKey]", "page");
}

export async function getWorkItemAttachments(input: {
  workItemId: string;
}): Promise<WorkItemAttachmentPayload> {
  const parsed = listWorkItemAttachmentsSchema.parse(input);
  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  const [attachments, viewerMemberId, abilities] = await Promise.all([
    listWorkItemAttachments(item.id, item.organizationId),
    callerMemberId(item.organizationId, session.user.id),
    hasOrgPermission(item.organizationId, ORG_BYPASS).then((bypass) =>
      callerAttachmentAbilities(
        item.organizationId,
        item.projectId,
        session.user.id,
        bypass,
      ),
    ),
  ]);

  return {
    workItemId: item.id,
    attachments,
    viewerMemberId,
    ...abilities,
  };
}

/**
 * Rename an attachment, or (re)write its caption.
 *
 * The stored object is NOT touched: `storageKey` carries the attachment's id
 * rather than its name precisely so a rename costs one UPDATE instead of a copy
 * plus a delete. What the browser downloads as comes from this column at serve
 * time.
 */
export async function updateWorkItemAttachment(input: {
  attachmentId: string;
  fileName: string;
  description?: string | null;
}): Promise<void> {
  const parsed = updateWorkItemAttachmentSchema.parse(input);
  const existing = await loadAttachmentOrThrow(parsed.attachmentId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );
  await assertPlatformNotLocked();

  await assertCanEdit(existing, session.user.id, "rename");

  // Sanitized again here, not just at upload: this string ends up in a
  // Content-Disposition header, and it arrived from a client either way.
  const fileName = sanitizeFileName(parsed.fileName);

  await db
    .update(workItemAttachment)
    .set({ fileName, description: parsed.description })
    .where(eq(workItemAttachment.id, existing.id));

  const item = await loadWorkItemOrThrow(existing.workItemId);
  const key = workItemKey(item.projectKey, item.number);

  await recordAudit({
    action: "workItemAttachment.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.workItemId,
    metadata: {
      attachmentId: existing.id,
      key,
      projectId: existing.projectId,
      from: existing.fileName,
      to: fileName,
      fieldKey: existing.fieldKey,
    },
  });

  scheduleAttachmentEmbedding({
    attachmentId: existing.id,
    organizationId: existing.organizationId,
    fileName,
    description: parsed.description,
  });
  revalidateItem();
}

/**
 * Remove an attachment: the row AND the bytes.
 *
 * The object goes first-class rather than being left to a sweeper — an orphaned
 * blob is data we said we deleted. `storage().delete` is idempotent, so a retry
 * after a partial failure still converges, and the row is deleted second so a
 * store error leaves something to retry FROM rather than a dangling key.
 */
export async function deleteWorkItemAttachment(input: {
  attachmentId: string;
}): Promise<void> {
  const parsed = deleteWorkItemAttachmentSchema.parse(input);
  const existing = await loadAttachmentOrThrow(parsed.attachmentId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );
  await assertPlatformNotLocked();

  const { moderated } = await assertCanEdit(
    existing,
    session.user.id,
    "delete",
  );

  await storage().delete(existing.storageKey);
  await db
    .delete(workItemAttachment)
    .where(eq(workItemAttachment.id, existing.id));

  const item = await loadWorkItemOrThrow(existing.workItemId);
  const key = workItemKey(item.projectKey, item.number);

  await recordAudit({
    action: "workItemAttachment.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.workItemId,
    metadata: {
      attachmentId: existing.id,
      key,
      projectId: existing.projectId,
      // Kept so the trail still says WHAT was removed once the row is gone.
      fileName: existing.fileName,
      contentType: existing.contentType,
      size: existing.size,
      fieldKey: existing.fieldKey,
      storageKey: existing.storageKey,
      moderated,
    },
  });

  revalidateItem();
}

/**
 * Your own upload, or attachment:manage. Returns whether this was someone
 * else's file, which the audit entry records — "who removed whose" is exactly
 * the question a trail gets asked.
 */
async function assertCanEdit(
  existing: Awaited<ReturnType<typeof loadAttachmentOrThrow>>,
  userId: string,
  verb: "rename" | "delete",
): Promise<{ moderated: boolean }> {
  const [viewerMemberId, bypass] = await Promise.all([
    callerMemberId(existing.organizationId, userId),
    hasOrgPermission(existing.organizationId, ORG_BYPASS),
  ]);
  const abilities = await callerAttachmentAbilities(
    existing.organizationId,
    existing.projectId,
    userId,
    bypass,
  );
  const isOwn =
    existing.uploadedById === userId ||
    (existing.uploadedByMemberId !== null &&
      existing.uploadedByMemberId === viewerMemberId);

  const allowed = canEditAttachment(existing, {
    ...abilities,
    viewerMemberId,
  });
  if (!allowed) {
    throw new Error(
      verb === "delete"
        ? "You can only delete your own attachments."
        : "You can only rename your own attachments.",
    );
  }

  return { moderated: !isOwn };
}
