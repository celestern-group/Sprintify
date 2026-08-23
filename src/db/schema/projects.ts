import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ProjectPermissionKey } from "@/lib/project-permissions";
import { member, organization } from "./auth";
import { holidayCalendar } from "./calendar";
import { vector } from "./columns";

export const project = pgTable(
  "project",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Short human-readable identifier used in URLs (/app/[orgSlug]/[projectKey])
    // and in issue references. Uppercase alphanumeric, unique within the
    // organization, immutable after create — enforced in the server actions,
    // since links and references would rot if it moved.
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    // Best-effort semantic-search vector over name + description, generated
    // on write by src/lib/ai/embeddings.ts. embeddingModel records which
    // model produced it, since queries must compare only same-model vectors
    // (see src/db/schema/columns.ts).
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    // Sprint cadence defaults. Every new sprint copies these as a snapshot
    // (see src/db/schema/sprints.ts) so editing them here never rewrites the
    // arithmetic of sprints that already ran.
    capacityUnit: text({ enum: ["hours", "points"] })
      .default("hours")
      .notNull(),
    sprintLengthDays: integer().default(14).notNull(),
    defaultHoursPerDay: numeric({ precision: 5, scale: 2, mode: "number" })
      .default(8)
      .notNull(),
    // 0 = Sunday. Members may narrow this further in their own profile.
    workingWeekdays: jsonb()
      .$type<number[]>()
      .notNull()
      .default(sql`'[1,2,3,4,5]'::jsonb`),
    timezone: text().default("UTC").notNull(),
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
    index("project_organizationId_idx").on(table.organizationId),
    check(
      "project_sprintLengthDays_check",
      sql`${table.sprintLengthDays} between 1 and 90`,
    ),
    uniqueIndex("project_organizationId_key_uidx").on(
      table.organizationId,
      table.key,
    ),
  ],
);

// Role definitions. `projectId` is the scope discriminator: NULL means an
// organization-catalog role shared by every project (and the target an HR sync
// writes into), while a set `projectId` means a role local to that one project.
export const projectRole = pgTable(
  "projectRole",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text().references(() => project.id, { onDelete: "cascade" }),
    // Stable identifier for external mapping (e.g. an SAP job code resolves to
    // a key). Immutable after create — enforced in the server actions.
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    permissions: jsonb()
      .$type<ProjectPermissionKey[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isDefault: boolean().default(false).notNull(),
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
    // Postgres treats NULLs as distinct, so one (organizationId, projectId, key)
    // index would leave catalog rows entirely unconstrained. Two partial
    // indexes, one per scope.
    uniqueIndex("projectRole_organizationId_key_uidx")
      .on(table.organizationId, table.key)
      .where(sql`${table.projectId} is null`),
    uniqueIndex("projectRole_projectId_key_uidx")
      .on(table.projectId, table.key)
      .where(sql`${table.projectId} is not null`),
    // One default per organization. Note this is keyed on organizationId —
    // unlike plan_single_default_uidx, which is a global singleton.
    uniqueIndex("projectRole_organizationId_default_uidx")
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true`),
    // The conflict target for upserting roles synced from an external system.
    uniqueIndex("projectRole_organizationId_externalId_uidx")
      .on(table.organizationId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    index("projectRole_organizationId_idx").on(table.organizationId),
    index("projectRole_projectId_idx").on(table.projectId),
    // Deleting a role reassigns its holders to the org default, so that default
    // must always be reachable from every project.
    check(
      "projectRole_default_org_scoped_check",
      sql`not (${table.isDefault} and ${table.projectId} is not null)`,
    ),
  ],
);

// Points at `member` rather than `user` so removing someone from the org
// cascades their project memberships away, and so a non-member can't be added.
export const projectMember = pgTable(
  "projectMember",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    // `no action` rather than `restrict`: deleting a project cascades to both
    // projectMember and projectRole, and Postgres does not order those cascade
    // triggers. RESTRICT is checked immediately and would raise a spurious
    // violation if the projectRole cascade happened to fire first; NO ACTION is
    // checked at end-of-statement, once the membership rows are already gone.
    roleId: text()
      .notNull()
      .references(() => projectRole.id, { onDelete: "no action" }),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("projectMember_projectId_memberId_uidx").on(
      table.projectId,
      table.memberId,
    ),
    index("projectMember_memberId_idx").on(table.memberId),
    index("projectMember_roleId_idx").on(table.roleId),
  ],
);

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, {
    fields: [project.organizationId],
    references: [organization.id],
  }),
  projectMembers: many(projectMember),
  projectRoles: many(projectRole),
  holidayCalendar: one(holidayCalendar, {
    fields: [project.holidayCalendarId],
    references: [holidayCalendar.id],
  }),
}));

export const projectRoleRelations = relations(projectRole, ({ one, many }) => ({
  organization: one(organization, {
    fields: [projectRole.organizationId],
    references: [organization.id],
  }),
  project: one(project, {
    fields: [projectRole.projectId],
    references: [project.id],
  }),
  projectMembers: many(projectMember),
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  project: one(project, {
    fields: [projectMember.projectId],
    references: [project.id],
  }),
  member: one(member, {
    fields: [projectMember.memberId],
    references: [member.id],
  }),
  role: one(projectRole, {
    fields: [projectMember.roleId],
    references: [projectRole.id],
  }),
}));
