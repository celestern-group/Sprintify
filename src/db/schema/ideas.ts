import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  integer,
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

/** A project-visible proposal, deliberately separate from committed work. */
export const idea = pgTable(
  "idea",
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
    authorMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    title: text().notNull(),
    description: text().notNull(),
    status: text({ enum: ["open", "reviewing", "converted", "declined"] })
      .default("open")
      .notNull(),
    /** The current, human-editable delivery plan. AI only ever proposes it. */
    plan: jsonb()
      .$type<Array<{ summary: string; description: string }>>()
      .notNull()
      .default([]),
    planUpdatedAt: timestamp(),
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
    index("idea_projectId_idx").on(table.projectId),
    index("idea_organizationId_idx").on(table.organizationId),
  ],
);

/** A person explicitly asked to provide a decision on an idea. */
export const ideaReviewer = pgTable(
  "ideaReviewer",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ideaId: text()
      .notNull()
      .references(() => idea.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    requestedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ideaReviewer_ideaId_memberId_uidx").on(
      table.ideaId,
      table.memberId,
    ),
    index("ideaReviewer_ideaId_idx").on(table.ideaId),
  ],
);

/** A project-visible discussion attached to an idea. */
export const ideaComment = pgTable(
  "ideaComment",
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
    ideaId: text()
      .notNull()
      .references(() => idea.id, { onDelete: "cascade" }),
    /** Replies may nest without a fixed depth limit. */
    parentId: text().references((): AnyPgColumn => ideaComment.id, {
      onDelete: "cascade",
    }),
    authorMemberId: text().references(() => member.id, {
      onDelete: "set null",
    }),
    authorId: text().references(() => user.id, { onDelete: "set null" }),
    authorName: text(),
    authorEmail: text(),
    body: text().notNull(),
    /** Project members named in the markdown, resolved server-side on write. */
    mentionedMemberIds: jsonb()
      .$type<string[]>()
      .notNull()
      .default([] as string[]),
    embedding: vector("embedding"),
    embeddingModel: text(),
    embeddingUpdatedAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    index("ideaComment_ideaId_createdAt_idx").on(table.ideaId, table.createdAt),
    index("ideaComment_parentId_createdAt_idx").on(
      table.parentId,
      table.createdAt,
    ),
  ],
);

/** One member's one catalog reaction on an idea-discussion comment. */
export const ideaCommentReaction = pgTable(
  "ideaCommentReaction",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    commentId: text()
      .notNull()
      .references(() => ideaComment.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    emoji: text().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ideaCommentReaction_comment_member_emoji_uidx").on(
      table.commentId,
      table.memberId,
      table.emoji,
    ),
    index("ideaCommentReaction_commentId_idx").on(table.commentId),
  ],
);

/** One considered opinion per member; score is impact, 1 (low) through 5 (high). */
export const ideaEvaluation = pgTable(
  "ideaEvaluation",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ideaId: text()
      .notNull()
      .references(() => idea.id, { onDelete: "cascade" }),
    memberId: text()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    impact: integer().notNull(),
    effort: integer().notNull(),
    note: text(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("ideaEvaluation_ideaId_memberId_uidx").on(
      table.ideaId,
      table.memberId,
    ),
    index("ideaEvaluation_ideaId_idx").on(table.ideaId),
  ],
);

/** Preserves the decision trail after an idea becomes planned work. */
export const ideaWorkItem = pgTable(
  "ideaWorkItem",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ideaId: text()
      .notNull()
      .references(() => idea.id, { onDelete: "cascade" }),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ideaWorkItem_ideaId_workItemId_uidx").on(
      table.ideaId,
      table.workItemId,
    ),
    index("ideaWorkItem_ideaId_idx").on(table.ideaId),
  ],
);

export const ideaRelations = relations(idea, ({ one, many }) => ({
  project: one(project, { fields: [idea.projectId], references: [project.id] }),
  evaluations: many(ideaEvaluation),
  workItems: many(ideaWorkItem),
  reviewers: many(ideaReviewer),
  comments: many(ideaComment),
}));

export const ideaReviewerRelations = relations(ideaReviewer, ({ one }) => ({
  idea: one(idea, { fields: [ideaReviewer.ideaId], references: [idea.id] }),
  member: one(member, {
    fields: [ideaReviewer.memberId],
    references: [member.id],
  }),
}));

export const ideaCommentRelations = relations(ideaComment, ({ one, many }) => ({
  idea: one(idea, { fields: [ideaComment.ideaId], references: [idea.id] }),
  author: one(member, {
    fields: [ideaComment.authorMemberId],
    references: [member.id],
  }),
  reactions: many(ideaCommentReaction),
}));

export const ideaCommentReactionRelations = relations(
  ideaCommentReaction,
  ({ one }) => ({
    comment: one(ideaComment, {
      fields: [ideaCommentReaction.commentId],
      references: [ideaComment.id],
    }),
    member: one(member, {
      fields: [ideaCommentReaction.memberId],
      references: [member.id],
    }),
  }),
);

export const ideaWorkItemRelations = relations(ideaWorkItem, ({ one }) => ({
  idea: one(idea, { fields: [ideaWorkItem.ideaId], references: [idea.id] }),
  workItem: one(workItem, {
    fields: [ideaWorkItem.workItemId],
    references: [workItem.id],
  }),
}));

export const ideaEvaluationRelations = relations(ideaEvaluation, ({ one }) => ({
  idea: one(idea, { fields: [ideaEvaluation.ideaId], references: [idea.id] }),
  member: one(member, {
    fields: [ideaEvaluation.memberId],
    references: [member.id],
  }),
}));
