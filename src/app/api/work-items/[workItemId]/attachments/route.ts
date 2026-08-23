import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { scheduleNotifications } from "@/lib/notifications";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import { requireProjectPermission } from "@/lib/project-access";
import {
  BodyTooLargeError,
  readLimitedFormData,
} from "@/lib/request-body-limit";
import { storage } from "@/lib/storage";
import { workItemAttachmentKey } from "@/lib/storage/attachments";
import { normalizeContentType, sanitizeFileName } from "@/lib/storage/uploads";
import { loadWorkItemOrThrow } from "@/lib/work-item-access";
import {
  AttachmentRoomError,
  assertAttachmentRoomLeft,
  callerMemberId,
  insertAttachmentRows,
  listWorkItemAttachments,
  type PendingAttachment,
  resolveFieldKey,
  scheduleAttachmentEmbedding,
} from "@/lib/work-item-attachment-access";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_REQUEST,
  type WorkItemAttachmentRow,
} from "@/lib/work-item-attachments";
import { workItemKey } from "@/lib/work-items";

// The upload half of work-item attachments.
//
// A route handler rather than a server action because a multipart body is far
// larger than the server-action body limit — the same reason the admin
// explorer's upload lives in a route. Everything else about an attachment (list,
// rename, delete) is a server action in src/lib/actions/work-item-attachments.ts.
//
// This is also the ONLY place bytes enter the store for an item, which is what
// lets the size cap, the per-item cap and the content-type normalization be
// stated once.

export const runtime = "nodejs";

/**
 * Largest body this route will buffer, enforced as the body streams in (see
 * `readLimitedFormData`) rather than after `request.formData()` has already
 * materialized every part.
 *
 * The per-file cap below can only run after parsing, so without this the size
 * of a body we buffer is whatever the client chose to send. This bounds it to
 * what the route would have accepted anyway: the full complement of max-size
 * files, plus slack for multipart boundaries, part headers and the `fieldKey`
 * field.
 */
const MAX_REQUEST_BYTES =
  MAX_ATTACHMENTS_PER_REQUEST * MAX_ATTACHMENT_BYTES + 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workItemId: string }> },
) {
  const { workItemId } = await params;

  let item: Awaited<ReturnType<typeof loadWorkItemOrThrow>>;
  let session: Awaited<ReturnType<typeof requireProjectPermission>>;
  try {
    item = await loadWorkItemOrThrow(workItemId);
    session = await requireProjectPermission(
      item.organizationId,
      item.projectId,
      "attachment:create",
      { project: ["update"] },
      "You don't have permission to attach files to this project.",
    );
    await assertPlatformNotLocked();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Forbidden" },
      { status: 403 },
    );
  }

  let formData: FormData | null;
  try {
    formData = await readLimitedFormData(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }

  const files = (formData?.getAll("file") ?? []).filter(
    (entry): entry is File => entry instanceof File,
  );
  if (files.length === 0) {
    return NextResponse.json(
      { error: "Expected at least one `file` field." },
      { status: 400 },
    );
  }
  if (files.length > MAX_ATTACHMENTS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Attach at most ${MAX_ATTACHMENTS_PER_REQUEST} files at a time.`,
      },
      { status: 413 },
    );
  }

  for (const file of files) {
    if (file.size === 0) {
      return NextResponse.json(
        { error: `"${file.name}" is empty.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        {
          error: `"${file.name}" is larger than ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 413 },
      );
    }
  }

  try {
    await assertAttachmentRoomLeft(item.id, files.length);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Too many files." },
      { status: 409 },
    );
  }

  // Where the drop landed. A hint from the client: re-resolved against the
  // org's own fields, and dropped to null when it names nothing real.
  const rawFieldKey = formData?.get("fieldKey");
  const fieldKey = await resolveFieldKey(
    item.organizationId,
    typeof rawFieldKey === "string" && rawFieldKey.trim()
      ? rawFieldKey.trim()
      : null,
  );

  const uploadedByMemberId = await callerMemberId(
    item.organizationId,
    session.user.id,
  );
  const key = workItemKey(item.projectKey, item.number);

  // Bytes first, rows second, and the rows all together: the cap and the item's
  // continued existence are both decided under one lock in insertAttachmentRows,
  // which a row-at-a-time loop can't do. Ids are minted here because each is
  // part of its own storage key — the bytes and the row have to agree.
  const pending: PendingAttachment[] = [];
  const cleanUpBytes = async () => {
    for (const entry of pending) {
      await storage()
        .delete(entry.storageKey)
        .catch(() => {});
    }
  };

  try {
    for (const file of files) {
      const id = crypto.randomUUID();
      const fileName = sanitizeFileName(file.name);
      const contentType = normalizeContentType(file.type);
      const storageKey = workItemAttachmentKey({
        organizationId: item.organizationId,
        workItemId: item.id,
        attachmentId: id,
        fileName,
      });

      await storage().put(
        storageKey,
        new Uint8Array(await file.arrayBuffer()),
        contentType,
      );
      pending.push({ id, storageKey, fileName, contentType, size: file.size });
    }

    await insertAttachmentRows({
      workItemId: item.id,
      organizationId: item.organizationId,
      projectId: item.projectId,
      fieldKey,
      uploadedByMemberId,
      uploadedById: session.user.id,
      uploadedByName: session.user.name,
      uploadedByEmail: session.user.email,
      files: pending,
    });
  } catch (error) {
    // Nothing points at these bytes — an insert that failed, an item deleted
    // underneath us, or a store that took some of the batch and then didn't.
    // Clean up rather than leave files we have no record of.
    await cleanUpBytes();
    if (error instanceof AttachmentRoomError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  for (const entry of pending) {
    await recordAudit({
      action: "workItemAttachment.created",
      organizationId: item.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: item.id,
      metadata: {
        attachmentId: entry.id,
        key,
        projectId: item.projectId,
        fileName: entry.fileName,
        contentType: entry.contentType,
        size: entry.size,
        fieldKey,
      },
    });

    scheduleAttachmentEmbedding({
      attachmentId: entry.id,
      organizationId: item.organizationId,
      fileName: entry.fileName,
      description: null,
    });
  }

  // Whoever owns the item and whoever reported it are the two people a new file
  // is evidence FOR. Everyone else reads it when they open the item.
  scheduleNotifications({
    organizationId: item.organizationId,
    recipientMemberIds: [item.assigneeMemberId, item.reporterMemberId],
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: uploadedByMemberId,
    },
    action: "workItem.attached",
    targetType: "workItem",
    targetId: item.id,
    metadata: {
      key,
      summary: item.summary,
      projectKey: item.projectKey,
      count: files.length,
      fileName: sanitizeFileName(files[0].name),
    },
  });

  revalidatePath("/app/[orgSlug]/[projectKey]/backlog/[itemKey]", "page");

  // The created rows come back already shaped: a prose field that just took a
  // drop needs the download URL to write a link, and a round-trip to the list
  // action for it would race the revalidate.
  const createdIds = new Set(pending.map((entry) => entry.id));
  const all = await listWorkItemAttachments(item.id, item.organizationId);
  const created: WorkItemAttachmentRow[] = all.filter((row) =>
    createdIds.has(row.id),
  );

  return NextResponse.json({ attachments: created });
}
