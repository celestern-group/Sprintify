import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { member, organization } from "./auth";
import { vector } from "./columns";

// The working-time substrate that sprint capacity is derived from. Three
// concerns, deliberately separate:
//
//   holidayCalendar/holiday — shared, org-owned, per-region non-working days.
//   memberCapacityProfile   — one person's default working pattern.
//   memberLeave             — one person's dated absences.
//
// All dates here are DATE columns in `string` mode ("YYYY-MM-DD"), never
// timestamps. A working day is a calendar day in the project's timezone; the
// moment a JS Date enters the pipeline the UTC offset can shift a day across a
// boundary and silently move someone's leave. src/lib/capacity.ts is the only
// place that reasons about these strings.

export const holidayCalendar = pgTable(
  "holidayCalendar",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    // Best-effort semantic-search vector over the calendar name, generated on
    // write by src/lib/ai/embeddings.ts (see src/db/schema/columns.ts for why
    // the column carries no fixed dimension).
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    timezone: text().default("UTC").notNull(),
    isDefault: boolean().default(false).notNull(),
    // Mirrors team/projectRole: an HR or HRIS system can own the calendar.
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
    index("holidayCalendar_organizationId_idx").on(table.organizationId),
    uniqueIndex("holidayCalendar_orgId_name_uidx").on(
      table.organizationId,
      table.name,
    ),
    // One default per organization — the calendar a project inherits when it
    // hasn't pinned one of its own.
    uniqueIndex("holidayCalendar_orgId_default_uidx")
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true`),
    uniqueIndex("holidayCalendar_orgId_externalId_uidx")
      .on(table.organizationId, table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);

export const holiday = pgTable(
  "holiday",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    calendarId: text()
      .notNull()
      .references(() => holidayCalendar.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    name: text().notNull(),
    // As holidayCalendar. Holidays are written in bulk (a whole year at a
    // time) and their names repeat heavily, so the batch is embedded by
    // distinct name — see scheduleEmbeddings in src/lib/ai/embeddings.ts.
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("holiday_calendarId_date_uidx").on(
      table.calendarId,
      table.date,
    ),
    index("holiday_calendarId_date_idx").on(table.calendarId, table.date),
  ],
);

// A person's default working pattern. Anchored on `member` (not `user`) so it
// is org-scoped and cascades away when they leave the organization — the same
// anchor teamMember and projectMember use.
export const memberCapacityProfile = pgTable(
  "memberCapacityProfile",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    hoursPerDay: numeric({ precision: 5, scale: 2, mode: "number" })
      .default(8)
      .notNull(),
    // ISO-ish weekday numbers, 0 = Sunday. Stored as jsonb rather than a
    // bitmask so it stays readable in the DB and in audit metadata.
    workingWeekdays: jsonb()
      .$type<number[]>()
      .notNull()
      .default(sql`'[1,2,3,4,5]'::jsonb`),
    // Null falls back to the organization's default calendar.
    holidayCalendarId: text().references(() => holidayCalendar.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("memberCapacityProfile_memberId_uidx").on(table.memberId),
    index("memberCapacityProfile_organizationId_idx").on(table.organizationId),
    check(
      "memberCapacityProfile_hoursPerDay_check",
      sql`${table.hoursPerDay} >= 0 and ${table.hoursPerDay} <= 24`,
    ),
  ],
);

export const LEAVE_TYPES = [
  "vacation",
  "sick",
  "personal",
  "training",
  "other",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["planned", "confirmed", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const memberLeave = pgTable(
  "memberLeave",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    // Inclusive range: a single day is startDate === endDate.
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    // 1.00 = whole days, 0.50 = half days across the range.
    portion: numeric({ precision: 3, scale: 2, mode: "number" })
      .default(1)
      .notNull(),
    type: text({ enum: LEAVE_TYPES }).default("vacation").notNull(),
    status: text({ enum: LEAVE_STATUSES }).default("planned").notNull(),
    // Free text, but deliberately NOT embedded and never copied into audit
    // metadata — it is personal data about a person's absence.
    note: text(),
    createdByMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("memberLeave_orgId_memberId_startDate_idx").on(
      table.organizationId,
      table.memberId,
      table.startDate,
    ),
    // The recompute query after a leave edit scans by org + overlapping range.
    index("memberLeave_orgId_range_idx").on(
      table.organizationId,
      table.startDate,
      table.endDate,
    ),
    check(
      "memberLeave_range_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "memberLeave_portion_check",
      sql`${table.portion} > 0 and ${table.portion} <= 1`,
    ),
  ],
);

// Kept for parity with the rest of the schema; nothing reads these yet, but
// every other table exposes its relations and drizzle's relational queries
// need them the moment a `with:` clause appears.
export const holidayCalendarRelations = relations(
  holidayCalendar,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [holidayCalendar.organizationId],
      references: [organization.id],
    }),
    holidays: many(holiday),
  }),
);

export const holidayRelations = relations(holiday, ({ one }) => ({
  calendar: one(holidayCalendar, {
    fields: [holiday.calendarId],
    references: [holidayCalendar.id],
  }),
}));

export const memberCapacityProfileRelations = relations(
  memberCapacityProfile,
  ({ one }) => ({
    organization: one(organization, {
      fields: [memberCapacityProfile.organizationId],
      references: [organization.id],
    }),
    member: one(member, {
      fields: [memberCapacityProfile.memberId],
      references: [member.id],
    }),
    holidayCalendar: one(holidayCalendar, {
      fields: [memberCapacityProfile.holidayCalendarId],
      references: [holidayCalendar.id],
    }),
  }),
);

export const memberLeaveRelations = relations(memberLeave, ({ one }) => ({
  organization: one(organization, {
    fields: [memberLeave.organizationId],
    references: [organization.id],
  }),
  member: one(member, {
    fields: [memberLeave.memberId],
    references: [member.id],
  }),
}));

// Exported for the leave UI so the label list can't drift from the enum.
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  training: "Training",
  other: "Other",
};
