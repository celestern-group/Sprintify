import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { member, organization, user } from "./auth";

// Per-recipient in-app notifications, fanned out at mutation time by
// src/lib/notifications.ts alongside the audit entry. The auditLog stays the
// append-only source of truth; this table exists because audit rows have no
// recipient and no read state — deriving "what's unread for me" from the org
// trail would mean scanning it per user on every bell render.
//
// Anchored to `member` (not `user`), mirroring teamMember: removing someone
// from the org cascades their notifications away, and a non-member can never
// hold one. Actor name/email are denormalized so the row still renders after
// the actor's account is deleted (FK is ON DELETE SET NULL, like auditLog).
export const notification = pgTable(
  "notification",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    recipientMemberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    actorId: text().references(() => user.id, { onDelete: "set null" }),
    actorName: text(),
    actorEmail: text(),
    // Same namespaced vocabulary as auditLog.action ("workItem.assigned",
    // "sprint.started") — one language for events across both tables.
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    // Whatever the bell needs to render and deep-link without joins: the item
    // key, a summary, the project key/org slug for the href.
    metadata: jsonb().$type<Record<string, unknown>>(),
    readAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    // The bell's two queries: unread count and newest-first list, both scoped
    // to one recipient.
    index("notification_recipient_readAt_createdAt_idx").on(
      table.recipientMemberId,
      table.readAt,
      table.createdAt,
    ),
    index("notification_organizationId_createdAt_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const notificationRelations = relations(notification, ({ one }) => ({
  organization: one(organization, {
    fields: [notification.organizationId],
    references: [organization.id],
  }),
  recipient: one(member, {
    fields: [notification.recipientMemberId],
    references: [member.id],
  }),
  actor: one(user, {
    fields: [notification.actorId],
    references: [user.id],
  }),
}));
