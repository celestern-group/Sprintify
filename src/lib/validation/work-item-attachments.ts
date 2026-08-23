import { z } from "zod";
import { idSchema } from "@/lib/validation/common";
import {
  isBuiltInAttachmentFieldKey,
  MAX_ATTACHMENT_DESCRIPTION,
  MAX_ATTACHMENT_FILE_NAME,
} from "@/lib/work-item-attachments";

// Input schemas for the work-item attachment route and actions.

/**
 * Where a file was dropped. Shape only: a built-in prose key is checkable here,
 * a custom field id is a ROW, so the action re-resolves it against the org's
 * field definitions — an id that isn't one becomes a plain unfiled attachment
 * rather than an error, since the file itself is still what the person wanted.
 */
export const attachmentFieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .nullish()
  .transform((value) => value ?? null);

export function isPlausibleFieldKey(value: string): boolean {
  // Built-ins are exact; anything else has to at least LOOK like one of our
  // ids before it earns a database round-trip.
  return isBuiltInAttachmentFieldKey(value) || /^[\w-]{1,64}$/.test(value);
}

/**
 * The name shown and downloaded as. Sanitized again server-side before it
 * shapes a `Content-Disposition` header — this cap is about the column and the
 * layout, not about safety.
 */
export const attachmentFileNameSchema = z
  .string()
  .trim()
  .min(1, "A file needs a name.")
  .max(MAX_ATTACHMENT_FILE_NAME);

export const listWorkItemAttachmentsSchema = z.object({
  workItemId: idSchema,
});

export const updateWorkItemAttachmentSchema = z.object({
  attachmentId: idSchema,
  fileName: attachmentFileNameSchema,
  description: z
    .string()
    .trim()
    .max(MAX_ATTACHMENT_DESCRIPTION)
    .nullish()
    .transform((value) => value || null),
});

export const deleteWorkItemAttachmentSchema = z.object({
  attachmentId: idSchema,
});
