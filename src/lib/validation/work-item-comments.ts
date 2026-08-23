import { z } from "zod";
import { isCommentReactionEmoji } from "@/lib/comment-reactions";
import { idSchema } from "@/lib/validation/common";

// Input schemas for the work-item comment actions.

/**
 * Shorter than a description (20k) on purpose: a comment is a message, and the
 * cap is what stops one paste from dominating a thread that renders in full.
 */
export const commentBodySchema = z.string().trim().min(1).max(8_000);

/**
 * Ids the editor's @-mention node carried. Treated as a HINT only — the action
 * re-resolves every one against the project's membership before it notifies,
 * so a hand-crafted payload can't page someone outside the project.
 */
const mentionsSchema = z
  .array(idSchema)
  .max(50)
  .optional()
  .transform((ids) => [...new Set(ids ?? [])]);

export const listWorkItemCommentsSchema = z.object({
  workItemId: idSchema,
});

export const createWorkItemCommentSchema = z.object({
  workItemId: idSchema,
  body: commentBodySchema,
  /**
   * The comment being replied to. Shape only — the action re-loads the parent
   * and verifies it belongs to the same work item, which is not knowable here.
   */
  parentId: idSchema.nullish(),
  mentionedMemberIds: mentionsSchema,
});

/**
 * Checked against the closed catalog rather than "is this a string": the
 * column would otherwise accept any glyph a client cares to send, and the
 * picker could never render what it got back.
 */
export const toggleCommentReactionSchema = z.object({
  commentId: idSchema,
  emoji: z
    .string()
    .refine(isCommentReactionEmoji, "That isn't an available reaction."),
});

export const updateWorkItemCommentSchema = z.object({
  commentId: idSchema,
  body: commentBodySchema,
  mentionedMemberIds: mentionsSchema,
});

export const deleteWorkItemCommentSchema = z.object({
  commentId: idSchema,
});
