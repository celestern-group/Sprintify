import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// A public request to join the platform while invite-only mode is active.
// It intentionally belongs to the platform, rather than an organization: an
// approved person receives a Sprintify account and can then join or create the
// workspace that is right for them.
export const wishlistRequest = pgTable(
  "wishlistRequest",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull(),
    status: text().default("pending").notNull(),
    requestedAt: timestamp().defaultNow().notNull(),
    approvedAt: timestamp(),
    approvedByUserId: text().references(() => user.id, {
      onDelete: "set null",
    }),
    provisionedUserId: text().references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("wishlistRequest_email_uidx").on(table.email),
    index("wishlistRequest_status_requestedAt_idx").on(
      table.status,
      table.requestedAt,
    ),
  ],
);
