import { relations, sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { member, organization } from "./auth";
import { vector } from "./columns";

// Teams are an ORG-LEVEL grouping of members — a lens for assigning and
// filtering work, deliberately NOT an access-control unit (access flows only
// through projectMember). Conventions mirror projectRole/projectMember:
// member-anchored membership so org removal cascades, and an externalId/source
// pair so an HR system can sync org units later.
export const team = pgTable(
  "team",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    // Best-effort semantic-search vector, generated on write by
    // src/lib/ai/embeddings.ts (see src/db/schema/columns.ts).
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
    index("team_organizationId_idx").on(table.organizationId),
    // Team names are unique within an organization.
    uniqueIndex("team_orgId_name_uidx").on(table.organizationId, table.name),
    // The conflict target for upserting teams synced from an external system
    // (mirrors projectRole_organizationId_externalId_uidx).
    uniqueIndex("team_orgId_externalId_uidx")
      .on(table.organizationId, table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);

// Points at `member` (not `user`) so removing someone from the org cascades
// them out of every team, and a non-member can't be added to a team.
export const teamMember = pgTable(
  "teamMember",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text()
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("teamMember_teamId_memberId_uidx").on(
      table.teamId,
      table.memberId,
    ),
    index("teamMember_teamId_idx").on(table.teamId),
    index("teamMember_memberId_idx").on(table.memberId),
  ],
);

export const teamRelations = relations(team, ({ one, many }) => ({
  organization: one(organization, {
    fields: [team.organizationId],
    references: [organization.id],
  }),
  teamMembers: many(teamMember),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
  member: one(member, {
    fields: [teamMember.memberId],
    references: [member.id],
  }),
}));
