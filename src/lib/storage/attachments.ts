import "server-only";
import { assertSafeStorageKey } from "./keys";
import { sanitizeFileName } from "./uploads";

/** Prefix every work-item attachment lives under. */
export const ATTACHMENT_PREFIX = "attachments/";

/**
 * Where one attachment's bytes live.
 *
 * The key carries the attachment's ID, not just its name: two people dropping
 * `screenshot.png` on the same item must not collide, and a RENAME must not
 * have to move bytes (the store has no rename — a move is copy-then-delete).
 * The filename is kept as the last segment anyway so the platform storage
 * browser is legible to an admin looking for one file.
 *
 * Org and item ids are in the path for the same reason: an operator staring at
 * the bucket can tell whose data it is, and a per-org purge is one prefix.
 */
export function workItemAttachmentKey(input: {
  organizationId: string;
  workItemId: string;
  attachmentId: string;
  fileName: string;
}): string {
  const key = `${ATTACHMENT_PREFIX}${input.organizationId}/${input.workItemId}/${input.attachmentId}/${sanitizeFileName(input.fileName)}`;
  // The ids are ours and the name is sanitized, so this can only fire on a
  // genuinely broken caller — but the store is the one place where "can only"
  // is not good enough.
  assertSafeStorageKey(key);
  return key;
}
