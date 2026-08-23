import { z } from "zod";
import {
  WORK_ITEM_FIELD_PLACEMENTS,
  WORK_ITEM_FIELD_TYPES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_TONES,
  WORK_ITEM_VALUE_LEVELS,
  WORKFLOW_STATUS_CATEGORIES,
} from "@/db/schema/work-items";
import { idSchema, isoDateSchema } from "@/lib/validation/common";
import { WORK_ITEM_ICONS } from "@/lib/work-items";

// Input schemas for the backlog server actions.

export const workItemSummarySchema = z.string().trim().min(1).max(300);
export const workItemDescriptionSchema = z.string().trim().max(20_000);

// Labels are short free-text tags, deduped and capped so one item can't carry
// an unbounded array into every board render.
export const labelsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((labels) => [...new Set(labels)]);

const dateRange = z
  .object({
    startDate: isoDateSchema.nullish(),
    dueDate: isoDateSchema.nullish(),
  })
  .refine(
    (value) =>
      !value.startDate || !value.dueDate || value.startDate <= value.dueDate,
    { message: "An item can't be due before it starts.", path: ["dueDate"] },
  );

// The built-in content blocks, shared by create and update. Defect fields are
// accepted regardless of type: the form hides them when the type doesn't track
// defects, but a type change must not silently drop what someone wrote.
const contentBlocks = {
  description: workItemDescriptionSchema.optional(),
  acceptanceCriteria: workItemDescriptionSchema.optional(),
  technicalNotes: workItemDescriptionSchema.optional(),
  definitionOfDone: workItemDescriptionSchema.optional(),
  stepsToReproduce: workItemDescriptionSchema.optional(),
  expectedResult: workItemDescriptionSchema.optional(),
  actualResult: workItemDescriptionSchema.optional(),
  businessValue: z.enum(WORK_ITEM_VALUE_LEVELS).nullish(),
  riskLevel: z.enum(WORK_ITEM_VALUE_LEVELS).nullish(),
  /**
   * Custom field values, keyed by field id. Shapes vary by field type and are
   * checked against the definition by coerceFieldValue in the action — zod
   * can't know the catalog, so it only guarantees this is a plain map.
   */
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createWorkItemSchema = z
  .object({
    projectId: idSchema,
    typeId: idSchema,
    // Optional: falls back to the project's default status.
    statusId: idSchema.optional(),
    summary: workItemSummarySchema,
    ...contentBlocks,
    priority: z.enum(WORK_ITEM_PRIORITIES).default("medium"),
    points: z.number().min(0).max(10_000).nullish(),
    actualEfforts: z.number().min(0).max(100_000).nullish(),
    assigneeMemberId: idSchema.nullish(),
    parentId: idSchema.nullish(),
    sprintId: idSchema.nullish(),
    labels: labelsSchema.optional(),
  })
  .and(dateRange);

export const updateWorkItemSchema = z
  .object({
    workItemId: idSchema,
    typeId: idSchema,
    statusId: idSchema,
    summary: workItemSummarySchema,
    ...contentBlocks,
    priority: z.enum(WORK_ITEM_PRIORITIES),
    points: z.number().min(0).max(10_000).nullish(),
    actualEfforts: z.number().min(0).max(100_000).nullish(),
    assigneeMemberId: idSchema.nullish(),
    /**
     * The one PATCH field on an otherwise full-replace action: OMIT the key to
     * leave the item where it hangs, send `null` to detach it. The hierarchy
     * panel owns the link (see `setWorkItemParentSchema`), so a form that ships
     * its own stale copy alongside a priority tweak would silently undo a move
     * made seconds earlier.
     */
    parentId: idSchema.nullish(),
    sprintId: idSchema.nullish(),
    labels: labelsSchema.optional(),
  })
  .and(dateRange);

export const workItemIdSchema = z.object({ workItemId: idSchema });

/**
 * One link in the hierarchy, moved on its own. Deliberately NOT a slice of
 * `updateWorkItemSchema`: that action is a full replace, so re-parenting through
 * it would mean the client shipping every prose block back just to change one
 * foreign key — and losing whatever a second tab wrote in between.
 *
 * The action is symmetric by design: linking a parent sends the item itself,
 * linking a child sends the CHILD as `workItemId`. `null` detaches.
 */
export const setWorkItemParentSchema = z.object({
  workItemId: idSchema,
  parentId: idSchema.nullable(),
});

/** A symmetric peer relationship, distinct from an item's hierarchy parent. */
export const workItemLinkSchema = z.object({
  workItemId: idSchema,
  relatedWorkItemId: idSchema,
});

/**
 * One bar dragged or resized on the timeline. Deliberately NOT a slice of
 * `updateWorkItemSchema` for the same reason the parent isn't: that action is a
 * full replace, and a view that only knows an item's dates would have to echo
 * every prose block back to move it — nulling whatever it didn't carry.
 *
 * Both dates are REQUIRED keys (nullable, not optional): a drag always knows
 * both ends of the bar it just placed, so there is no "leave the other one
 * alone" case to guess at, and `null` clears a date outright.
 */
export const rescheduleWorkItemSchema = z
  .object({
    workItemId: idSchema,
    startDate: isoDateSchema.nullable(),
    dueDate: isoDateSchema.nullable(),
  })
  .refine(
    (value) =>
      !value.startDate || !value.dueDate || value.startDate <= value.dueDate,
    { message: "An item can't be due before it starts.", path: ["dueDate"] },
  );

/**
 * One drag. Every field except the item is optional so the same action serves
 * all four views: the board sends a status, the backlog sends a sprint, both
 * send the neighbours they were dropped between.
 *
 * Neighbours are ids rather than a computed rank — a client that could name its
 * own rank could collide with the unique index, and the neighbours are what the
 * user actually pointed at.
 *
 * `parentId` rides along for the nested list's drop, which re-parents AND
 * re-ranks in one gesture: two actions would mean the parent could land while
 * the rank was refused, leaving the database holding half a drag.
 */
export const moveWorkItemSchema = z.object({
  workItemId: idSchema,
  statusId: idSchema.optional(),
  /** null clears the sprint (back to the backlog); undefined leaves it alone. */
  sprintId: idSchema.nullish(),
  /** null detaches from the parent; undefined leaves the hierarchy alone. */
  parentId: idSchema.nullish(),
  beforeId: idSchema.nullish(),
  afterId: idSchema.nullish(),
});

/** One ordered block dropped into a backlog gap. */
export const moveWorkItemsSchema = z.object({
  workItemIds: z
    .array(idSchema)
    .min(2)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "An item can only be moved once per batch.",
    }),
  sprintId: idSchema.nullish(),
  beforeId: idSchema.nullish(),
  afterId: idSchema.nullish(),
});

export const assignWorkItemSchema = z.object({
  workItemId: idSchema,
  assigneeMemberId: idSchema.nullable(),
});

/**
 * The backlog's right-click menu: ONE attribute, set on one or more items.
 *
 * PATCH-shaped like `moveWorkItemSchema` and for the same reason — an OMITTED
 * key leaves the field alone, an explicit `null` clears it. The menu never
 * holds the item's prose, so routing this through `updateWorkItemSchema` (a
 * full replace) would null every block the list never loaded.
 *
 * `workItemIds` is a list because the same gesture serves a multi-selection;
 * one row is just a batch of one. The cap is the practical size of a
 * selection, not a database limit — a request past it is a bug or an attack,
 * and either way it should be refused before it becomes 5,000 audit rows.
 */
export const setWorkItemAttributesSchema = z.object({
  workItemIds: z.array(idSchema).min(1).max(200),
  statusId: idSchema.optional(),
  /** null clears the sprint (back to the backlog); undefined leaves it alone. */
  sprintId: idSchema.nullish(),
  /** null unassigns; undefined leaves the assignee alone. */
  assigneeMemberId: idSchema.nullish(),
  priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
  /** null clears the estimate; undefined leaves it alone. */
  points: z.number().min(0).max(10_000).nullish(),
});

// --- Work item types (organization-scoped) ---

export const createWorkItemTypeSchema = z.object({
  organizationId: idSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).optional(),
  hierarchyLevel: z
    .number()
    .int()
    .min(0, "Hierarchy level must be zero or greater."),
  /** Off, items of this type ignore the level rule and nest anywhere. */
  strictHierarchy: z.boolean().default(true),
  tone: z.enum(WORK_ITEM_TONES).default("brand"),
  icon: z.enum(WORK_ITEM_ICONS).default("IconFile"),
  isDefault: z.boolean().default(false),
  /** Items of this type carry steps to reproduce / expected / actual. */
  tracksDefect: z.boolean().default(false),
});

// `key` is absent on purpose: immutable after create, like projectRole.key.
export const updateWorkItemTypeSchema = createWorkItemTypeSchema.extend({
  typeId: idSchema,
});

export const workItemTypeIdSchema = z.object({
  organizationId: idSchema,
  typeId: idSchema,
});

// --- Workflow statuses (project-scoped) ---

export const createWorkflowStatusSchema = z.object({
  projectId: idSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(WORKFLOW_STATUS_CATEGORIES),
  wipLimit: z.number().int().min(1).max(999).nullish(),
});

export const updateWorkflowStatusSchema = createWorkflowStatusSchema.extend({
  statusId: idSchema,
  isDefault: z.boolean().optional(),
});

export const workflowStatusIdSchema = z.object({ statusId: idSchema });

/** Reordering the board's columns sends the full ordered id list. */
export const reorderWorkflowStatusesSchema = z.object({
  projectId: idSchema,
  statusIds: z.array(idSchema).min(1).max(30),
});

// --- Custom fields (organization-scoped) ---

const fieldOptionSchema = z.object({
  value: z.string().trim().max(60),
  label: z.string().trim().min(1).max(60),
});

export const createWorkItemFieldSchema = z.object({
  organizationId: idSchema,
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).optional(),
  fieldType: z.enum(WORK_ITEM_FIELD_TYPES),
  // Only meaningful for select fields; normalized (and required) in the action,
  // which is the side that knows whether this field type uses them.
  options: z.array(fieldOptionSchema).max(50).optional(),
  /** Empty = the field appears on every type. */
  appliesToTypeIds: z.array(idSchema).max(50).optional(),
  isRequired: z.boolean().optional(),
  helpText: z.string().trim().max(280).optional(),
  /** Which half of the item form the input renders in. Defaults to main. */
  placement: z.enum(WORK_ITEM_FIELD_PLACEMENTS).optional(),
});

// `key` is absent on purpose: immutable after create, like workItemType.key.
export const updateWorkItemFieldSchema = createWorkItemFieldSchema.extend({
  fieldId: idSchema,
});

export const workItemFieldIdSchema = z.object({
  organizationId: idSchema,
  fieldId: idSchema,
});

export const reorderWorkItemFieldsSchema = z.object({
  organizationId: idSchema,
  fieldIds: z.array(idSchema).min(1).max(100),
});
