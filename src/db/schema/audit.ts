import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// Append-only audit trail. Written from server actions and Better Auth hooks;
// never updated or deleted in normal operation. `actorId`/`organizationId` are
// nullable so system events and platform-level events can be recorded, and
// `actorEmail` is denormalized so the record survives the actor's deletion
// (the FK is ON DELETE SET NULL, not cascade).
export const auditLog = pgTable(
  "auditLog",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    actorId: text().references(() => user.id, { onDelete: "set null" }),
    actorEmail: text(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    ipAddress: text(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    index("auditLog_organizationId_createdAt_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("auditLog_actorId_createdAt_idx").on(table.actorId, table.createdAt),
    // Per-target history reads (e.g. a work item's History section) filter on
    // the target pair and want newest-first without scanning the org's trail.
    index("auditLog_target_createdAt_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
  ],
);
