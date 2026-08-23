import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { member, organization, user } from "./auth";
import { vector } from "./columns";
import { project } from "./projects";
import { workItem } from "./work-items";

/**
 * A comment is written by a person or by the assistant. An enum rather than a
 * boolean because "who wrote this" is the kind of axis that grows (an
 * integration posting build results is the next one), and a `isAi` column
 * would have to be renamed the day it does.
 */
export const WORK_ITEM_COMMENT_AUTHOR_KINDS = ["human", "ai"] as const;
export type WorkItemCommentAuthorKind =
  (typeof WORK_ITEM_COMMENT_AUTHOR_KINDS)[number];

// The discussion attached to one work item.
//
// Two shape decisions worth knowing:
//
//  - `authorMemberId` is ON DELETE SET NULL, NOT cascade. Notifications and
//    teamMember cascade off `member` because they are per-person state that
//    means nothing once the person leaves; a comment is CONTENT — the thread
//    has to still read as a conversation after someone is removed from the
//    org. The denormalized authorName/authorEmail (same trick as auditLog) is
//    what keeps the row renderable once the join target is gone.
//  - `body` is markdown, the same storage form as every other prose field in
//    the app (see RichTextField). It is rendered to sanitized HTML on the
//    SERVER at read time (src/lib/markdown.ts) — the client never supplies
//    HTML, so a pasted <script> can't become one.
export const workItemComment = pgTable(
  "workItemComment",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Denormalized from the item so the permission gate on a comment id can be
    // resolved without a join, and so a project-scoped purge is one predicate.
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    /**
     * The comment this one replies to. Exactly one level deep: the action
     * refuses a parent that itself has a parent. Cascade matches the
     * hard-delete choice: removing a comment takes its replies with it.
     */
    parentId: text().references((): AnyPgColumn => workItemComment.id, {
      onDelete: "cascade",
    }),
    /**
     * Who wrote it — a PERSON or the assistant. The assistant's comments carry
     * no member and no user, so "is this AI" cannot be inferred from a null
     * author (a removed teammate looks the same). It is a stored fact because
     * a reader has to be able to tell, permanently, which words in a thread a
     * human actually committed to.
     */
    authorKind: text({ enum: WORK_ITEM_COMMENT_AUTHOR_KINDS })
      .default("human")
      .notNull(),
    /** The model that produced an `ai` comment, for provenance. Null for humans. */
    aiModel: text(),
    authorMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    authorId: text().references(() => user.id, { onDelete: "set null" }),
    authorName: text(),
    authorEmail: text(),
    /** Markdown. Rendered server-side; never trusted as HTML. */
    body: text().notNull(),
    /**
     * The member ids the body @-mentions, resolved and re-validated against the
     * project's membership at write time. Stored (rather than re-parsed on
     * read) so an edit can notify only the NEWLY mentioned people.
     */
    mentionedMemberIds: jsonb()
      .$type<string[]>()
      .notNull()
      .default([] as string[]),
    /** Set on every edit after the first write — the "edited" marker. */
    editedAt: timestamp(),
    // Comment prose is exactly the kind of free text someone searches by
    // meaning, so it carries an embedding like every other prose surface.
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
    // The only list query: one item's thread, oldest first.
    index("workItemComment_workItemId_createdAt_idx").on(
      table.workItemId,
      table.createdAt,
    ),
    index("workItemComment_organizationId_createdAt_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("workItemComment_parentId_createdAt_idx").on(
      table.parentId,
      table.createdAt,
    ),
  ],
);

/**
 * One person's one emoji on one comment. Anchored to `member` with a CASCADE
 * (unlike the comment itself): a reaction is per-person state, not content —
 * once someone leaves the org, "who reacted" has no answer worth keeping, and
 * the count should drop rather than name a ghost.
 *
 * The emoji is stored as text but is not free-form: the actions validate it
 * against COMMENT_REACTIONS (src/lib/comment-reactions.ts), so the column can
 * never accumulate a hundred one-off glyphs that the picker cannot show.
 */
export const workItemCommentReaction = pgTable(
  "workItemCommentReaction",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    commentId: text()
      .notNull()
      .references(() => workItemComment.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    emoji: text().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    // The toggle's identity: reacting twice with the same emoji removes it
    // rather than stacking, and the index is what makes that a single upsert
    // -shaped decision instead of a read-then-write race.
    uniqueIndex("workItemCommentReaction_comment_member_emoji_uidx").on(
      table.commentId,
      table.memberId,
      table.emoji,
    ),
    index("workItemCommentReaction_commentId_idx").on(table.commentId),
  ],
);

export const workItemCommentRelations = relations(
  workItemComment,
  ({ one, many }) => ({
    parent: one(workItemComment, {
      fields: [workItemComment.parentId],
      references: [workItemComment.id],
      relationName: "commentReplies",
    }),
    replies: many(workItemComment, { relationName: "commentReplies" }),
    reactions: many(workItemCommentReaction),
    organization: one(organization, {
      fields: [workItemComment.organizationId],
      references: [organization.id],
    }),
    project: one(project, {
      fields: [workItemComment.projectId],
      references: [project.id],
    }),
    workItem: one(workItem, {
      fields: [workItemComment.workItemId],
      references: [workItem.id],
    }),
    authorMember: one(member, {
      fields: [workItemComment.authorMemberId],
      references: [member.id],
    }),
    author: one(user, {
      fields: [workItemComment.authorId],
      references: [user.id],
    }),
  }),
);

export const workItemCommentReactionRelations = relations(
  workItemCommentReaction,
  ({ one }) => ({
    comment: one(workItemComment, {
      fields: [workItemCommentReaction.commentId],
      references: [workItemComment.id],
    }),
    member: one(member, {
      fields: [workItemCommentReaction.memberId],
      references: [member.id],
    }),
  }),
);
