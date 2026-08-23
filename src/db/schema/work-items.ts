import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { member, organization } from "./auth";
import { vector } from "./columns";
import { project } from "./projects";
import { sprint } from "./sprints";

// The backlog layer: what a work item IS (workItemType, org-scoped), where it
// sits in a project's flow (workflowStatus, project-scoped) and the item itself
// (workItem, project-scoped).
//
// Two deliberate splits:
//
//  - Types are ORG-level data, not code. An organization runs one vocabulary
//    across its projects ("Story" means the same thing everywhere), and an HR /
//    portfolio system may hand us types we've never heard of — hence
//    source/externalId, mirroring team and projectRole.
//  - Statuses are PROJECT-level data. Two projects in the same org legitimately
//    run different flows, and the board's columns ARE these rows.
//
// Both carry a `category` / `hierarchyLevel` discriminator so the code can
// reason about them without ever branching on a name — the same rule that
// governs projectRole (names mean nothing, keys and categories do).

// Where a type sits in the parent/child tree. Level 0 is highest; each higher
// non-negative number sits lower in the hierarchy.
export type WorkItemHierarchyLevel = number;

// The tone a type's icon square renders in. Names, not hexes: a hex would
// escape the design system, and these map to Aurora tokens in the UI.
export const WORK_ITEM_TONES = [
  "brand",
  "blue",
  "success",
  "amber",
  "danger",
  "neutral",
] as const;
export type WorkItemTone = (typeof WORK_ITEM_TONES)[number];

// What a status means to the code. The board groups columns by it, "done"
// stamps completedAt, and burn-down arithmetic reads it — never the name.
export const WORKFLOW_STATUS_CATEGORIES = [
  "todo",
  "in_progress",
  "done",
] as const;
export type WorkflowStatusCategory =
  (typeof WORKFLOW_STATUS_CATEGORIES)[number];

export const WORKFLOW_STATUS_CATEGORY_LABELS: Record<
  WorkflowStatusCategory,
  string
> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const WORK_ITEM_PRIORITIES = [
  "lowest",
  "low",
  "medium",
  "high",
  "highest",
] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export const WORK_ITEM_PRIORITY_LABELS: Record<WorkItemPriority, string> = {
  lowest: "Lowest",
  low: "Low",
  medium: "Medium",
  high: "High",
  highest: "Highest",
};

// Business value and risk are the two prioritisation dimensions that aren't
// urgency. Deliberately nullable with no default: "nobody has assessed this
// yet" is a real and common state, and a default would quietly claim otherwise.
export const WORK_ITEM_VALUE_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type WorkItemValueLevel = (typeof WORK_ITEM_VALUE_LEVELS)[number];

export const WORK_ITEM_VALUE_LABELS: Record<WorkItemValueLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

// What a custom field holds. The value column is jsonb, so this is what tells
// the server how to validate and the client how to render — never inferred
// from the value itself.
export const WORK_ITEM_FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "date",
  "checkbox",
  "single_select",
  "multi_select",
  "user",
  "url",
] as const;
export type WorkItemFieldType = (typeof WORK_ITEM_FIELD_TYPES)[number];

export const WORK_ITEM_FIELD_TYPE_LABELS: Record<WorkItemFieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  single_select: "Single select",
  multi_select: "Multi select",
  user: "Person",
  url: "Link",
};

// Where a custom field renders on the item form. The form is content + meta:
// the main column is for what the item IS (prose, criteria), the sidebar is for
// where it sits (short values someone scans without scrolling). A field that
// holds a paragraph belongs in one and a severity dropdown in the other, and
// only the org that defined it knows which — hence a stored choice, not a guess
// from the field type.
export const WORK_ITEM_FIELD_PLACEMENTS = ["main", "side"] as const;
export type WorkItemFieldPlacement =
  (typeof WORK_ITEM_FIELD_PLACEMENTS)[number];

export const WORK_ITEM_FIELD_PLACEMENT_LABELS: Record<
  WorkItemFieldPlacement,
  string
> = {
  main: "Main section",
  side: "Side panel",
};

// Org-level vocabulary. `key` is the stable identifier an external system maps
// onto and is immutable after create (same rule as projectRole.key); `name` is
// what people see and may be renamed freely.
export const workItemType = pgTable(
  "workItemType",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    hierarchyLevel: integer().default(1).notNull(),
    // Does `hierarchyLevel` actually CONSTRAIN where items of this type go?
    //
    // On (the default, and the only behaviour before this column existed) means
    // a parent must sit at a strictly higher level (a lower number). Off means
    // items of this type drop anywhere: the level rule is
    // skipped entirely, so a Task can sit under a Story, another Task, or a
    // Sub-task. It reads off the CHILD's type, because the question a drop asks
    // is "where may THIS item live", and the seed catalog puts Story, Task and
    // Bug all at level 1 — under a strict rule none of them can hold another,
    // which is most of what people actually try to drag.
    //
    // Self-parenting and cycles are refused whatever this says: those aren't a
    // matter of preference, they'd make the tree views recurse forever.
    strictHierarchy: boolean().default(true).notNull(),
    tone: text({ enum: WORK_ITEM_TONES }).default("brand").notNull(),
    // Tabler icon name (e.g. "IconBookmark"), resolved through an allow-list in
    // src/lib/work-items.ts — never rendered as arbitrary markup.
    icon: text().default("IconFile").notNull(),
    // The type a "New item" button proposes. One per organization.
    isDefault: boolean().default(false).notNull(),
    // Whether items of this type carry the defect fields (steps to reproduce,
    // expected, actual). A FLAG, not a name check: role and type names mean
    // nothing to the code here, exactly as in project-permissions.ts — an org
    // that calls its defect type "Defeito" or "Incident" still gets the fields.
    tracksDefect: boolean().default(false).notNull(),
    // Position in pickers, so an org can put Story before Bug.
    position: integer().default(0).notNull(),
    // name + description is prose someone would search by meaning.
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    source: text({ enum: ["local", "sap"] })
      .default("local")
      .notNull(),
    externalId: text(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workItemType_organizationId_key_uidx").on(
      table.organizationId,
      table.key,
    ),
    uniqueIndex("workItemType_organizationId_name_uidx").on(
      table.organizationId,
      table.name,
    ),
    // One default per organization — enforced here rather than in the action,
    // since two concurrent "make this the default" calls would both pass a
    // read-then-write check. The action clears the old default first.
    uniqueIndex("workItemType_organizationId_default_uidx")
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true`),
    uniqueIndex("workItemType_organizationId_externalId_uidx")
      .on(table.organizationId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    index("workItemType_organizationId_idx").on(table.organizationId),
    check(
      "workItemType_hierarchyLevel_check",
      sql`${table.hierarchyLevel} >= 0`,
    ),
  ],
);

// A project's flow. These rows ARE the board's columns, in `position` order.
export const workflowStatus = pgTable(
  "workflowStatus",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Denormalized from `project` so org-scoped reads don't need a join and a
    // forged projectId can't be paired with someone else's organizationId
    // (same reasoning as sprint.organizationId).
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    category: text({ enum: WORKFLOW_STATUS_CATEGORIES })
      .default("todo")
      .notNull(),
    position: integer().default(0).notNull(),
    // Where a newly created item lands. One per project.
    isDefault: boolean().default(false).notNull(),
    // Optional per-column WIP limit; the board warns past it rather than
    // blocking the drop — a hard block hides work instead of surfacing it.
    wipLimit: integer(),
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workflowStatus_projectId_name_uidx").on(
      table.projectId,
      table.name,
    ),
    uniqueIndex("workflowStatus_projectId_default_uidx")
      .on(table.projectId)
      .where(sql`${table.isDefault} = true`),
    index("workflowStatus_projectId_position_idx").on(
      table.projectId,
      table.position,
    ),
    index("workflowStatus_organizationId_idx").on(table.organizationId),
    check(
      "workflowStatus_wipLimit_check",
      sql`${table.wipLimit} is null or ${table.wipLimit} > 0`,
    ),
  ],
);

export const workItem = pgTable(
  "workItem",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    // Monotonic per project. The human-facing reference is
    // `${project.key}-${number}` (see workItemKey in src/lib/work-items.ts) —
    // stored as a number rather than the composed string so renaming is never
    // tempting and the sequence is one max()+1.
    number: integer().notNull(),
    typeId: text()
      .notNull()
      .references(() => workItemType.id, { onDelete: "restrict" }),
    statusId: text()
      .notNull()
      .references(() => workflowStatus.id, { onDelete: "restrict" }),
    // Self-reference: an item's parent must be a type at a strictly higher
    // hierarchyLevel, enforced in the server action (Postgres can't see the
    // type rows from here). Deleting a parent orphans rather than cascades —
    // losing a whole epic's worth of stories to one confirm would be worse
    // than leaving them at the top level.
    parentId: text().references((): AnyPgColumn => workItem.id, {
      onDelete: "set null",
    }),
    sprintId: text().references(() => sprint.id, { onDelete: "set null" }),
    summary: text().notNull(),
    description: text(),
    // The built-in content blocks. These are columns rather than custom fields
    // because every methodology has them under some name, the create form
    // depends on them existing, and they all feed the embedding — a custom
    // field can't be a hard dependency of either.
    acceptanceCriteria: text(),
    technicalNotes: text(),
    definitionOfDone: text(),
    // Defect fields. Shown when the item's TYPE has tracksDefect set; stored
    // unconditionally, so changing an item's type never destroys what someone
    // already wrote.
    stepsToReproduce: text(),
    expectedResult: text(),
    actualResult: text(),
    businessValue: text({ enum: WORK_ITEM_VALUE_LEVELS }),
    riskLevel: text({ enum: WORK_ITEM_VALUE_LEVELS }),
    priority: text({ enum: WORK_ITEM_PRIORITIES }).default("medium").notNull(),
    // Estimate in the project's capacityUnit. Nullable: unestimated is a real
    // and common state, and 0 must not stand in for it.
    points: numeric({ precision: 10, scale: 2, mode: "number" }),
    // Time actually spent, in hours. This intentionally stays separate from
    // the planning estimate: actuals are reporting data, never capacity input.
    actualEfforts: numeric({ precision: 10, scale: 2, mode: "number" }),
    assigneeMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    reporterMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    startDate: date({ mode: "string" }),
    dueDate: date({ mode: "string" }),
    labels: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Fractional lexicographic rank (src/lib/rank.ts). A string, not an
    // integer: reordering one row between two others must touch exactly that
    // row, never renumber the backlog. Unique per project so two rows can't
    // collide into an unstable order.
    rank: text().notNull(),
    // Stamped when the item enters a `done`-category status, cleared when it
    // leaves one. Read by velocity/burn-down arithmetic, which must not have
    // to ask "when did this last change status".
    completedAt: timestamp(),
    // Every prose block on the item — summary, description, acceptance
    // criteria, technical notes, definition of done, the defect fields, plus
    // the text of any custom field — joined into one vector. Exactly the
    // content someone would search for by meaning.
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workItem_projectId_number_uidx").on(
      table.projectId,
      table.number,
    ),
    uniqueIndex("workItem_projectId_rank_uidx").on(table.projectId, table.rank),
    // The backlog and board reads: everything in a project in rank order, and
    // everything in one sprint or one column.
    index("workItem_projectId_rank_idx").on(table.projectId, table.rank),
    index("workItem_projectId_statusId_idx").on(
      table.projectId,
      table.statusId,
    ),
    index("workItem_sprintId_idx").on(table.sprintId),
    index("workItem_parentId_idx").on(table.parentId),
    index("workItem_assigneeMemberId_idx").on(table.assigneeMemberId),
    index("workItem_organizationId_idx").on(table.organizationId),
    index("workItem_typeId_idx").on(table.typeId),
    check(
      "workItem_points_check",
      sql`${table.points} is null or ${table.points} >= 0`,
    ),
    check(
      "workItem_dates_check",
      sql`${table.startDate} is null or ${table.dueDate} is null or ${table.dueDate} >= ${table.startDate}`,
    ),
    // An item can never be its own parent. Deeper cycles are the action's job.
    check(
      "workItem_parent_self_check",
      sql`${table.parentId} is distinct from ${table.id}`,
    ),
  ],
);

// A peer-to-peer relationship is deliberately separate from `parentId`: a
// parent changes an item's place in the hierarchy, while a related item is a
// symmetric navigation/traceability link. The action stores the two ids in a
// stable lexical order, making one physical row represent one relationship.
export const workItemLink = pgTable(
  "workItemLink",
  {
    sourceWorkItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    targetWorkItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workItemLink_source_target_uidx").on(
      table.sourceWorkItemId,
      table.targetWorkItemId,
    ),
    index("workItemLink_targetWorkItemId_idx").on(table.targetWorkItemId),
    check(
      "workItemLink_distinct_items_check",
      sql`${table.sourceWorkItemId} <> ${table.targetWorkItemId}`,
    ),
  ],
);

// An organization's custom fields. Definitions are ORG-scoped for the same
// reason types are: a field means one thing across the organization, and
// redefining "Severity" per project is how two projects end up with two
// incompatible severity scales.
//
// `appliesToTypeIds` is the pin: empty means every type, otherwise the field
// only appears on the listed types. Stored as ids rather than keys so renaming
// a type can't orphan a field.
export const workItemField = pgTable(
  "workItemField",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Immutable after create, like workItemType.key — an export or an external
    // system maps onto it.
    key: text().notNull(),
    label: text().notNull(),
    description: text(),
    fieldType: text({ enum: WORK_ITEM_FIELD_TYPES }).notNull(),
    // Choices for single_select / multi_select: [{ value, label }]. Ignored by
    // every other field type; validated in the server action.
    options: jsonb()
      .$type<{ value: string; label: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Empty array = applies to every type in the organization.
    appliesToTypeIds: jsonb()
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isRequired: boolean().default(false).notNull(),
    // Shown under the input, for whoever has to fill it in.
    helpText: text(),
    // Which half of the item form the input renders in. Defaults to the main
    // column: an existing field keeps rendering exactly where it always did.
    placement: text({ enum: WORK_ITEM_FIELD_PLACEMENTS })
      .default("main")
      .notNull(),
    position: integer().default(0).notNull(),
    // label + description + helpText is prose someone would search by meaning.
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workItemField_organizationId_key_uidx").on(
      table.organizationId,
      table.key,
    ),
    uniqueIndex("workItemField_organizationId_label_uidx").on(
      table.organizationId,
      table.label,
    ),
    index("workItemField_organizationId_idx").on(table.organizationId),
  ],
);

// One row per (item, field) that has a value. Absent means unset — storing a
// row per field per item would multiply the table by the size of the catalog
// and make "has anyone ever filled this in?" unanswerable.
//
// `value` is jsonb because the shape depends on the field type (string, number,
// boolean, string[]). `textValue` is the same content flattened for search and
// for the item's embedding, so neither has to understand jsonb.
export const workItemFieldValue = pgTable(
  "workItemFieldValue",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    // Deleting a field takes its values with it — a value with no definition
    // can't be rendered, validated or explained.
    fieldId: text()
      .notNull()
      .references(() => workItemField.id, { onDelete: "cascade" }),
    value: jsonb().$type<unknown>(),
    textValue: text(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workItemFieldValue_workItemId_fieldId_uidx").on(
      table.workItemId,
      table.fieldId,
    ),
    index("workItemFieldValue_fieldId_idx").on(table.fieldId),
  ],
);

export const workItemFieldRelations = relations(
  workItemField,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [workItemField.organizationId],
      references: [organization.id],
    }),
    values: many(workItemFieldValue),
  }),
);

export const workItemFieldValueRelations = relations(
  workItemFieldValue,
  ({ one }) => ({
    workItem: one(workItem, {
      fields: [workItemFieldValue.workItemId],
      references: [workItem.id],
    }),
    field: one(workItemField, {
      fields: [workItemFieldValue.fieldId],
      references: [workItemField.id],
    }),
  }),
);

export const workItemTypeRelations = relations(
  workItemType,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [workItemType.organizationId],
      references: [organization.id],
    }),
    workItems: many(workItem),
  }),
);

export const workflowStatusRelations = relations(
  workflowStatus,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [workflowStatus.organizationId],
      references: [organization.id],
    }),
    project: one(project, {
      fields: [workflowStatus.projectId],
      references: [project.id],
    }),
    workItems: many(workItem),
  }),
);

export const workItemRelations = relations(workItem, ({ one, many }) => ({
  organization: one(organization, {
    fields: [workItem.organizationId],
    references: [organization.id],
  }),
  project: one(project, {
    fields: [workItem.projectId],
    references: [project.id],
  }),
  type: one(workItemType, {
    fields: [workItem.typeId],
    references: [workItemType.id],
  }),
  status: one(workflowStatus, {
    fields: [workItem.statusId],
    references: [workflowStatus.id],
  }),
  sprint: one(sprint, {
    fields: [workItem.sprintId],
    references: [sprint.id],
  }),
  parent: one(workItem, {
    fields: [workItem.parentId],
    references: [workItem.id],
    relationName: "workItemChildren",
  }),
  children: many(workItem, { relationName: "workItemChildren" }),
  fieldValues: many(workItemFieldValue),
  assignee: one(member, {
    fields: [workItem.assigneeMemberId],
    references: [member.id],
    relationName: "workItemAssignee",
  }),
  reporter: one(member, {
    fields: [workItem.reporterMemberId],
    references: [member.id],
    relationName: "workItemReporter",
  }),
  outgoingLinks: many(workItemLink, { relationName: "workItemLinkSource" }),
  incomingLinks: many(workItemLink, { relationName: "workItemLinkTarget" }),
}));

export const workItemLinkRelations = relations(workItemLink, ({ one }) => ({
  source: one(workItem, {
    fields: [workItemLink.sourceWorkItemId],
    references: [workItem.id],
    relationName: "workItemLinkSource",
  }),
  target: one(workItem, {
    fields: [workItemLink.targetWorkItemId],
    references: [workItem.id],
    relationName: "workItemLinkTarget",
  }),
}));
