import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { member, organization, user } from "./auth";
import { vector } from "./columns";
import { project } from "./projects";
import { workItem } from "./work-items";

// Files attached to one work item.
//
// The row is a REGISTRY entry, never the bytes: those live in the object store
// (src/lib/storage) under `storageKey`, and are only ever reachable through our
// own authenticated download route. Two consequences worth knowing:
//
//  - `storageKey` is immutable once written, and carries the attachment's id
//    rather than its name. Renaming an attachment therefore touches only this
//    row — the store has no rename (a move is copy-then-delete), and paying for
//    a byte copy so a key looks tidy is not worth it.
//  - Deleting the row deletes the object too (the action does both). A cascade
//    from `workItem` can't do that, so `deleteWorkItem` clears the objects
//    itself before the rows go — see src/lib/actions/work-items.ts.
//
// `uploadedByMemberId` is ON DELETE SET NULL with denormalized name/email, the
// same trick as workItemComment and auditLog: an attachment is CONTENT, so the
// list has to still say who added it after that person leaves the org.
export const workItemAttachment = pgTable(
  "workItemAttachment",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Denormalized from the item so a permission gate on an attachment id needs
    // no join, and a project-scoped purge is one predicate.
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    /**
     * The field the file was dropped ON — a built-in prose key ("description"),
     * a custom field id, or null when it was added from the Attachments tab.
     *
     * Stored as free text rather than an enum because half its vocabulary is
     * DATA: custom fields are rows, so their ids can't be a pg enum. Unknown
     * values render as an unlabelled attachment rather than breaking the list —
     * a field deleted after the drop must not orphan the file.
     */
    fieldKey: text(),
    /** Opaque object-store key. Immutable; see the note above. */
    storageKey: text().notNull().unique(),
    /** The name a person sees and downloads as. Editable. */
    fileName: text().notNull(),
    /** Normalized at upload — script-bearing types are flattened. */
    contentType: text().notNull(),
    /** Bytes, as the store received them. */
    size: integer().notNull(),
    /** Optional caption, written from the Attachments tab. Markdown-free prose. */
    description: text(),
    uploadedByMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    uploadedById: text().references(() => user.id, { onDelete: "set null" }),
    uploadedByName: text(),
    uploadedByEmail: text(),
    // A filename and its caption are exactly the kind of text someone searches
    // by meaning ("the architecture diagram"), so they carry an embedding like
    // every other prose surface.
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
    // The only list query: one item's attachments, oldest first.
    index("workItemAttachment_workItemId_createdAt_idx").on(
      table.workItemId,
      table.createdAt,
    ),
    index("workItemAttachment_organizationId_createdAt_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("workItemAttachment_projectId_idx").on(table.projectId),
  ],
);

export const workItemAttachmentRelations = relations(
  workItemAttachment,
  ({ one }) => ({
    organization: one(organization, {
      fields: [workItemAttachment.organizationId],
      references: [organization.id],
    }),
    project: one(project, {
      fields: [workItemAttachment.projectId],
      references: [project.id],
    }),
    workItem: one(workItem, {
      fields: [workItemAttachment.workItemId],
      references: [workItem.id],
    }),
    uploadedBy: one(member, {
      fields: [workItemAttachment.uploadedByMemberId],
      references: [member.id],
    }),
  }),
);
