import { z } from "zod";
import { AI_TEXT_OPERATIONS } from "@/lib/ai/assist-operations";
import { idSchema } from "@/lib/validation/common";

// Input schemas for the comment thread's AI actions.

/**
 * A free-text steer for the assistant. Capped hard: this is the ONE field a
 * user writes straight into a prompt, so it is the obvious lever for anyone
 * trying to smuggle a wall of instructions past the system message. Short
 * enough to be an instruction, too short to be a replacement prompt.
 */
const instructionSchema = z.string().trim().max(500).nullish();

export const assistCommentTextSchema = z.object({
  workItemId: idSchema,
  operation: z.enum(AI_TEXT_OPERATIONS),
  // The draft being rewritten, same limit as a stored comment — there is
  // nothing to assist on that couldn't be posted.
  text: z.string().trim().max(8_000),
  instruction: instructionSchema,
});

export const summarizeCommentThreadSchema = z.object({
  workItemId: idSchema,
});

export const suggestCommentReplySchema = z.object({
  workItemId: idSchema,
  parentId: idSchema.nullish(),
  instruction: instructionSchema,
});
