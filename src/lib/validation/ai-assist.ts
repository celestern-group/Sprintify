import { z } from "zod";
import { WORK_ITEM_PRIORITIES } from "@/db/schema/work-items";
import { AI_TEXT_OPERATIONS } from "@/lib/ai/assist-operations";
import { idSchema } from "@/lib/validation/common";
import {
  labelsSchema,
  workItemDescriptionSchema,
  workItemSummarySchema,
} from "@/lib/validation/work-items";

// Input schemas for the backlog's AI actions (src/lib/actions/ai-assist.ts).
//
// The prose caps mirror workItemDescriptionSchema: what gets sent to a model is
// what could be saved into the field, so a 20k field can be rewritten but an
// unbounded paste can't be used to run up the organization's provider bill.

/** Enough for a sentence of direction, short enough not to become the prompt. */
export const assistInstructionSchema = z.string().trim().min(1).max(500);

export const assistFieldTextSchema = z
  .object({
    projectId: idSchema,
    /** Present when editing a saved item — only used to caption the prompt. */
    workItemId: idSchema.nullish(),
    /** The field's own label, so custom prose fields work without a key. */
    fieldLabel: z.string().trim().min(1).max(80),
    operation: z.enum(AI_TEXT_OPERATIONS),
    /** Empty is legal for `custom` only — that's the write-from-nothing case. */
    text: z.string().trim().max(20_000),
    instruction: assistInstructionSchema.nullish(),
    /**
     * What the item is, as it stands in the form right now. Sent by the client
     * because on the create page there is no row to read it from — and it is
     * only ever the caller's own unsaved text, headed back into their own
     * prompt.
     */
    context: z
      .object({
        summary: z.string().trim().max(300).optional(),
        typeName: z.string().trim().max(60).optional(),
      })
      .optional(),
  })
  .refine((value) => value.operation === "custom" || value.text.length > 0, {
    message: "There's nothing in that field to rewrite yet.",
    path: ["text"],
  });

export const deriveAcceptanceCriteriaSchema = z.object({
  projectId: idSchema,
  workItemId: idSchema.nullish(),
  summary: workItemSummarySchema,
  description: workItemDescriptionSchema.min(1),
  existing: workItemDescriptionSchema.nullish(),
});

export const deriveDefectFieldsSchema = z.object({
  projectId: idSchema,
  workItemId: idSchema.nullish(),
  summary: workItemSummarySchema,
  report: z.string().trim().min(1).max(20_000),
});

export const draftWorkItemSchema = z.object({
  projectId: idSchema,
  request: z.string().trim().min(3).max(2000),
});

export const suggestChildWorkItemsSchema = z.object({
  workItemId: idSchema,
});

export const createChildWorkItemsSchema = z.object({
  parentId: idSchema,
  items: z
    .array(
      z.object({
        summary: workItemSummarySchema,
        description: workItemDescriptionSchema.optional(),
        acceptanceCriteria: workItemDescriptionSchema.optional(),
        points: z.number().min(0).max(10_000).nullish(),
      }),
    )
    .min(1)
    .max(12),
  /** Falls back to the lowest type below the parent's own level. */
  typeId: idSchema.nullish(),
  labels: labelsSchema.optional(),
  priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
});

export const similarWorkItemsSchema = z.object({
  projectId: idSchema,
  text: z.string().trim().min(3).max(20_000),
  excludeWorkItemId: idSchema.nullish(),
});

export const searchWorkItemsSchema = z.object({
  projectId: idSchema,
  query: z.string().trim().min(2).max(300),
});

export const suggestEstimateSchema = z.object({
  projectId: idSchema,
  workItemId: idSchema.nullish(),
  text: z.string().trim().min(3).max(20_000),
});
