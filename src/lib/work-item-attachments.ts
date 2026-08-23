import { isInlineImage } from "@/lib/storage/inline-types";

// Client-safe vocabulary for work-item attachments: the limits the uploader
// checks before it spends a request, and the field keys a drop can carry.
//
// A plain module (no db, no storage backend, no "use server") so the dropzone,
// the Attachments tab and the server action share one definition — a limit the
// client doesn't know is a limit the user only meets as a failed upload.

/**
 * Per-file cap. Well under the store's own 100 MB (MAX_UPLOAD_BYTES): a work
 * item is a document with evidence attached, not a file share, and 25 MB covers
 * screenshots, logs, PDFs and short screen recordings.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Per-item cap. Not a storage concern — a list nobody can scan has stopped
 * being useful, and a 200-file item is a symptom of something that should have
 * been split.
 */
export const MAX_ATTACHMENTS_PER_ITEM = 50;

/**
 * Per-REQUEST cap, well below the per-item cap above. Bytes are read into
 * memory a file at a time, so a request carries at most this many.
 *
 * The two limits are deliberately different numbers, which is exactly why this
 * one has to be client-side vocabulary: an uploader that only knows the 50 will
 * happily send 50 files in one request and eat a 413. The client batches on
 * this; the route restates it because a limit checked only in the browser isn't
 * a limit.
 */
export const MAX_ATTACHMENTS_PER_REQUEST = 10;

/**
 * Splits a drop into request-sized groups, order preserved. Lives here rather
 * than in the uploader so it sits next to the limit it exists to respect.
 */
export function batchedForUpload<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/** Cap on a caption. Long enough to explain a file, short enough to read. */
export const MAX_ATTACHMENT_DESCRIPTION = 500;

/**
 * Longest stored filename. Mirrors MAX_FILE_NAME in src/lib/storage/uploads.ts
 * (which is server-only, and this constant is also what the rename dialog
 * enforces) — the two must not drift.
 */
export const MAX_ATTACHMENT_FILE_NAME = 255;

/**
 * The built-in fields a file can be dropped on. A drop records WHERE it landed
 * so the list can say "this log belongs to Steps to reproduce" rather than
 * leaving eleven files in one undifferentiated pile.
 *
 * Custom fields are DATA, so their ids are valid `fieldKey` values too and are
 * validated against the org's field definitions server-side. Anything else is
 * rejected at the boundary; a key that stops resolving later (the field was
 * deleted) renders unlabelled rather than orphaning the file.
 */
/**
 * The discussion's own key. Not a form field — a picture pasted into a comment
 * is still an attachment on the ITEM (there is no per-comment registry, and a
 * comment can be deleted while the file it showed stays evidence), so it needs
 * somewhere to be filed that isn't Description. The Attachments tab reads this
 * label like any other.
 */
export const COMMENT_ATTACHMENT_FIELD_KEY = "comment";

export const WORK_ITEM_ATTACHMENT_FIELD_LABELS: Record<string, string> = {
  summary: "Name",
  description: "Description",
  acceptanceCriteria: "Acceptance criteria",
  technicalNotes: "Technical notes",
  definitionOfDone: "Definition of done",
  stepsToReproduce: "Steps to reproduce",
  expectedResult: "Expected",
  actualResult: "Actual",
  [COMMENT_ATTACHMENT_FIELD_KEY]: "Comments",
};

export const WORK_ITEM_BUILT_IN_FIELD_KEYS = Object.keys(
  WORK_ITEM_ATTACHMENT_FIELD_LABELS,
);

export function isBuiltInAttachmentFieldKey(key: string): boolean {
  return Object.hasOwn(WORK_ITEM_ATTACHMENT_FIELD_LABELS, key);
}

/**
 * One attachment as every surface renders it. Derived server-side — `url` is
 * our own authenticated route, never a storage URL, and `isImage` is resolved
 * with the same whitelist the route serves by so a thumbnail can't ask for a
 * preview the route will refuse.
 */
export type WorkItemAttachmentRow = {
  id: string;
  workItemId: string;
  fieldKey: string | null;
  /** The field's human label, resolved from built-ins and custom fields. */
  fieldLabel: string | null;
  fileName: string;
  contentType: string;
  size: number;
  description: string | null;
  uploadedByMemberId: string | null;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
  createdAt: Date;
  /** Download URL (our route). */
  url: string;
  /** Same route with ?inline=1 — null when this type must not render inline. */
  previewUrl: string | null;
  isImage: boolean;
};

/** What the CALLER may do with this item's attachments, resolved once. */
export type WorkItemAttachmentAbilities = {
  canUpload: boolean;
  /** Rename/delete ANYONE's — your own never needs a permission. */
  canManage: boolean;
  viewerMemberId: string | null;
};

export type WorkItemAttachmentPayload = WorkItemAttachmentAbilities & {
  workItemId: string;
  attachments: WorkItemAttachmentRow[];
};

/** The one download URL shape, so client and server can't disagree on it. */
export function attachmentUrl(
  workItemId: string,
  attachmentId: string,
  options?: { inline?: boolean },
): string {
  const path = `/api/work-items/${workItemId}/attachments/${attachmentId}`;
  return options?.inline ? `${path}?inline=1` : path;
}

/** Whether the viewer may rename/delete a specific row. */
export function canEditAttachment(
  row: Pick<WorkItemAttachmentRow, "uploadedByMemberId">,
  abilities: WorkItemAttachmentAbilities,
): boolean {
  if (abilities.canManage) return true;
  return (
    abilities.viewerMemberId !== null &&
    row.uploadedByMemberId === abilities.viewerMemberId
  );
}

/** Re-exported so client components don't reach into the storage layer. */
export { isInlineImage };
