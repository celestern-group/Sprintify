import { relations, sql } from "drizzle-orm";
import {
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

export const CAPACITY_UNITS = ["hours", "points"] as const;
export type CapacityUnit = (typeof CAPACITY_UNITS)[number];

export const SPRINT_STATES = ["planning", "active", "completed"] as const;
export type SprintState = (typeof SPRINT_STATES)[number];

// Sprints are PROJECT-scoped. Access flows through projectMember/projectRole
// exactly as it does for every other project object — teams stay a grouping
// lens and never appear in an authorization check here.
//
// Several columns are deliberate SNAPSHOTS of project settings taken at create
// time (capacityUnit, timezone, workingWeekdays). Changing a project's cadence
// must not silently rewrite the arithmetic behind sprints that already ran.
export const sprint = pgTable(
  "sprint",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Denormalized from `project` so org-scoped reads (audit, org-wide
    // timelines) don't need a join, and so a forged projectId can't be paired
    // with someone else's organizationId. Set from the project row on insert.
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    // Monotonic per project, so a sprint can be referred to as "Sprint 12"
    // regardless of what it was named.
    sequence: integer().notNull(),
    name: text().notNull(),
    goal: text(),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    state: text({ enum: SPRINT_STATES }).default("planning").notNull(),
    capacityUnit: text({ enum: CAPACITY_UNITS }).default("hours").notNull(),
    timezone: text().default("UTC").notNull(),
    workingWeekdays: jsonb()
      .$type<number[]>()
      .notNull()
      .default(sql`'[1,2,3,4,5]'::jsonb`),
    // Cached roll-up of sprintMemberCapacity, refreshed on every capacity
    // write so the sprint list doesn't have to aggregate per row.
    plannedCapacity: numeric({ precision: 10, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    // The last time the derived member-capacity rows were reconciled from
    // availability, calendars and leave. Kept separately from `updatedAt`,
    // which also changes for ordinary sprint edits.
    capacityLastSyncedAt: timestamp(),
    // Cached roll-up of workItem.points across every item scheduled into this
    // sprint (src/lib/capacity-sync.ts:refreshSprintCommittedPoints) — no
    // longer hand-entered. completedPoints stays manual until a similar
    // derivation from done items is built.
    committedPoints: numeric({ precision: 10, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    completedPoints: numeric({ precision: 10, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    startedAt: timestamp(),
    closedAt: timestamp(),
    closedByMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    // name + goal is prose someone would search by meaning, so it carries an
    // embedding like project/team/projectRole do.
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
    uniqueIndex("sprint_projectId_name_uidx").on(table.projectId, table.name),
    uniqueIndex("sprint_projectId_sequence_uidx").on(
      table.projectId,
      table.sequence,
    ),
    // At most one active sprint per project — enforced here rather than in the
    // action, because two concurrent "start sprint" calls would both pass a
    // read-then-write check. startSprint translates the 23505 into a message.
    uniqueIndex("sprint_projectId_active_uidx")
      .on(table.projectId)
      .where(sql`${table.state} = 'active'`),
    index("sprint_projectId_startDate_idx").on(
      table.projectId,
      table.startDate,
    ),
    index("sprint_organizationId_idx").on(table.organizationId),
    check("sprint_range_check", sql`${table.endDate} >= ${table.startDate}`),
  ],
);

// One row per project member per sprint, seeded when the sprint is created and
// kept in step as project membership changes.
//
// `isOverridden` is the load-bearing flag: recomputes triggered by a leave or
// holiday edit only touch rows where it is false, so a number a human typed is
// never silently replaced by a derived one.
//
// `hoursPerDayPinned` is the narrower version of the same idea for one column:
// the row still recomputes from leave/holidays, but its hours-per-day is a
// per-sprint number until the person next saves their global availability.
export const sprintMemberCapacity = pgTable(
  "sprintMemberCapacity",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sprintId: text()
      .notNull()
      .references(() => sprint.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    availabilityPercent: integer().default(100).notNull(),
    hoursPerDay: numeric({ precision: 5, scale: 2, mode: "number" })
      .default(8)
      .notNull(),
    // True once someone typed an hours-per-day for THIS sprint that differs
    // from what the row would inherit. Narrower than `isOverridden`: the row
    // is still derived (leave and holidays still move it), only the multiplier
    // is held. A subsequent availability-profile save deliberately wins and
    // clears this pin: that is an explicit change to the person's source
    // working pattern.
    hoursPerDayPinned: boolean().default(false).notNull(),
    // Derived columns — the sprint's working days for this person, and how
    // many of them their holidays and leave consume. Stored rather than
    // recomputed on read so the capacity table is one query.
    workingDays: numeric({ precision: 5, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    holidayDays: numeric({ precision: 5, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    leaveDays: numeric({ precision: 5, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    plannedHours: numeric({ precision: 10, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    plannedPoints: numeric({ precision: 10, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    isOverridden: boolean().default(false).notNull(),
    overrideReason: text(),
    // Semantic-search vector over overrideReason — the one free-text field on
    // this table, and the only record of WHY a human pinned a number. Cleared
    // alongside the reason whenever an override is dropped (see
    // src/lib/actions/capacity.ts), so a vector never outlives its text.
    // The row has no organizationId of its own; the write path and the
    // backfill both resolve it through `sprint`.
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    updatedByMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("sprintMemberCapacity_sprintId_memberId_uidx").on(
      table.sprintId,
      table.memberId,
    ),
    index("sprintMemberCapacity_memberId_idx").on(table.memberId),
    check(
      "sprintMemberCapacity_availability_check",
      sql`${table.availabilityPercent} >= 0 and ${table.availabilityPercent} <= 100`,
    ),
    check(
      "sprintMemberCapacity_hoursPerDay_check",
      sql`${table.hoursPerDay} >= 0 and ${table.hoursPerDay} <= 24`,
    ),
  ],
);

export const sprintRelations = relations(sprint, ({ one, many }) => ({
  organization: one(organization, {
    fields: [sprint.organizationId],
    references: [organization.id],
  }),
  project: one(project, {
    fields: [sprint.projectId],
    references: [project.id],
  }),
  capacities: many(sprintMemberCapacity),
}));

export const sprintMemberCapacityRelations = relations(
  sprintMemberCapacity,
  ({ one }) => ({
    sprint: one(sprint, {
      fields: [sprintMemberCapacity.sprintId],
      references: [sprint.id],
    }),
    member: one(member, {
      fields: [sprintMemberCapacity.memberId],
      references: [member.id],
    }),
  }),
);

export const SPRINT_STATE_LABELS: Record<SprintState, string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
};

export const CAPACITY_UNIT_LABELS: Record<CapacityUnit, string> = {
  hours: "Hours",
  points: "Story points",
};
