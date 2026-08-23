"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  member,
  projectMember,
  user,
  workItemComment,
  workItemCommentReaction,
} from "@/db/schema";
import type { WorkItemCommentAuthorKind } from "@/db/schema/comments";
import { tryGetAiClient } from "@/lib/ai/client";
import { scheduleAiCommentReply } from "@/lib/ai/comment-replies";
import { scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import {
  AI_AUTHOR_NAME,
  isAiMention,
  withoutAiMention,
} from "@/lib/comment-authors";
import { sortReactionEmojis } from "@/lib/comment-reactions";
import { markdownToPlainText, renderMarkdown } from "@/lib/markdown";
import { scheduleNotifications } from "@/lib/notifications";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import {
  hasOrgPermission,
  loadCallerProjectPermissions,
  requireProjectPermission,
} from "@/lib/project-access";
import { projectRoleCan } from "@/lib/project-permissions";
import { publishRealtime, workItemCommentsTopic } from "@/lib/realtime";
import {
  createWorkItemCommentSchema,
  deleteWorkItemCommentSchema,
  listWorkItemCommentsSchema,
  toggleCommentReactionSchema,
  updateWorkItemCommentSchema,
} from "@/lib/validation/work-item-comments";
import {
  loadWorkItemOrThrow,
  type StoredWorkItem,
} from "@/lib/work-item-access";
import { workItemKey } from "@/lib/work-items";

// The comment thread's read and write paths.
//
// Authorization mirrors the rest of the backlog layer: requireProjectPermission
// with an org-admin bypass, checked against the project resolved from the
// STORED row — never from an id the client paired with it. Reading needs
// backlog:view (if you can see the item you can read its discussion); posting
// needs comment:create, which the Viewer role deliberately lacks.

const VIEW_DENIED = "You don't have permission to view this project's backlog.";
const WRITE_DENIED = "You don't have permission to comment on this project.";
const ORG_BYPASS: Record<string, string[]> = { project: ["update"] };

function revalidateItem() {
  revalidatePath("/app/[orgSlug]/[projectKey]/backlog/[itemKey]", "page");
}

/**
 * One comment as the thread renders it. `bodyHtml` is derived on the server
 * from the stored markdown every time — the client never sends HTML and never
 * has to render markdown. `body` still travels because the editor needs the
 * markdown source to re-open an edit.
 */
export type WorkItemCommentRow = {
  id: string;
  workItemId: string;
  parentId: string | null;
  /**
   * Whether a PERSON wrote it. The assistant's comments carry no member and no
   * user, but so does a comment whose author left the org — only this tells
   * them apart, and the thread must never render AI text as a person's.
   */
  authorKind: WorkItemCommentAuthorKind;
  /** The model behind an `ai` comment, surfaced as provenance. */
  aiModel: string | null;
  authorMemberId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  authorImage: string | null;
  /** Markdown — the edit form's source. */
  body: string;
  /** Sanitized HTML — what the thread displays. */
  bodyHtml: string;
  mentionedMemberIds: string[];
  reactions: CommentReactionSummary[];
  editedAt: Date | null;
  createdAt: Date;
};

/**
 * One emoji's tally on one comment, already collapsed server-side. The client
 * gets a count and a "did I react" flag rather than the raw rows: a busy
 * comment would otherwise ship one row per person per emoji, and the only two
 * questions the chip asks are how many and whether it's me.
 */
export type CommentReactionSummary = {
  emoji: string;
  count: number;
  reacted: boolean;
  /** Who reacted, for the chip's tooltip. Capped — see REACTION_NAME_LIMIT. */
  names: string[];
};

/**
 * A comment with its recursive replies attached. Nesting is resolved here so
 * the client never has to reconstruct a tree from a flat list.
 */
export type WorkItemCommentNode = WorkItemCommentRow & {
  replies: WorkItemCommentNode[];
};

/**
 * What the CALLER may do in this thread, resolved once on the server so the UI
 * never has to guess. Per-comment authorship is compared client-side against
 * `viewerMemberId`; the actions re-check both halves regardless.
 */
export type WorkItemCommentThread = {
  workItemId: string;
  comments: WorkItemCommentNode[];
  /** Every comment including replies — what the tab's count shows. */
  totalCount: number;
  viewerMemberId: string | null;
  canComment: boolean;
  canModerate: boolean;
  /**
   * Whether the caller may attach files — what decides if the composer takes a
   * pasted screenshot. A separate key from `canComment`: attaching writes a row
   * on the item, and `attachment:create` is what governs that everywhere else.
   */
  canAttach: boolean;
  /**
   * Whether this organization has a usable AI provider. Drives whether the
   * mention menu offers the assistant and whether the AI controls render at
   * all — offering a button that can only ever answer "AI isn't configured" is
   * worse than not offering it.
   */
  aiEnabled: boolean;
};

/** Enough names for a tooltip to be useful; the rest become "and N others". */
const REACTION_NAME_LIMIT = 8;

export async function getWorkItemCommentThread(input: {
  workItemId: string;
}): Promise<WorkItemCommentThread> {
  const parsed = listWorkItemCommentsSchema.parse(input);
  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  const [rows, reactionRows, viewerMemberId, abilities, ai] = await Promise.all(
    [
      db
        .select({
          id: workItemComment.id,
          workItemId: workItemComment.workItemId,
          parentId: workItemComment.parentId,
          authorKind: workItemComment.authorKind,
          aiModel: workItemComment.aiModel,
          authorMemberId: workItemComment.authorMemberId,
          // The live account name wins while the account exists; the
          // denormalized copy is the fallback once it's deleted.
          userName: user.name,
          userImage: user.image,
          authorName: workItemComment.authorName,
          authorEmail: workItemComment.authorEmail,
          body: workItemComment.body,
          mentionedMemberIds: workItemComment.mentionedMemberIds,
          editedAt: workItemComment.editedAt,
          createdAt: workItemComment.createdAt,
        })
        .from(workItemComment)
        .leftJoin(user, eq(workItemComment.authorId, user.id))
        .where(eq(workItemComment.workItemId, parsed.workItemId))
        .orderBy(asc(workItemComment.createdAt)),
      // Joined through the comment rather than filtered by a list of ids: the
      // thread's ids aren't known until the query above returns, and a second
      // round trip to build an IN list buys nothing over one predicate.
      db
        .select({
          commentId: workItemCommentReaction.commentId,
          emoji: workItemCommentReaction.emoji,
          memberId: workItemCommentReaction.memberId,
          name: user.name,
          createdAt: workItemCommentReaction.createdAt,
        })
        .from(workItemCommentReaction)
        .innerJoin(
          workItemComment,
          eq(workItemCommentReaction.commentId, workItemComment.id),
        )
        .leftJoin(member, eq(workItemCommentReaction.memberId, member.id))
        .leftJoin(user, eq(member.userId, user.id))
        .where(eq(workItemComment.workItemId, parsed.workItemId))
        .orderBy(asc(workItemCommentReaction.createdAt)),
      callerMemberId(item.organizationId, session.user.id),
      callerCommentAbilities(
        item.organizationId,
        item.projectId,
        session.user.id,
      ),
      tryGetAiClient(item.organizationId),
    ],
  );

  const reactionsByComment = summarizeReactions(reactionRows, viewerMemberId);
  const comments: WorkItemCommentRow[] = rows.map((row) => ({
    id: row.id,
    workItemId: row.workItemId,
    parentId: row.parentId,
    authorKind: row.authorKind,
    aiModel: row.aiModel,
    authorMemberId: row.authorMemberId,
    // The assistant never borrows a person's name or face, even if a join
    // somehow produced one.
    authorName:
      row.authorKind === "ai"
        ? AI_AUTHOR_NAME
        : (row.userName ?? row.authorName),
    authorEmail: row.authorKind === "ai" ? null : row.authorEmail,
    authorImage: row.authorKind === "ai" ? null : (row.userImage ?? null),
    body: row.body,
    bodyHtml: renderMarkdown(row.body),
    mentionedMemberIds: row.mentionedMemberIds ?? [],
    reactions: reactionsByComment.get(row.id) ?? [],
    editedAt: row.editedAt,
    createdAt: row.createdAt,
  }));

  return {
    workItemId: parsed.workItemId,
    viewerMemberId,
    canComment: abilities.canComment,
    canModerate: abilities.canModerate,
    canAttach: abilities.canAttach,
    aiEnabled: Boolean(ai?.models.text),
    totalCount: comments.length,
    comments: nestReplies(comments),
  };
}

/**
 * Flat rows → a recursive comment forest. Child lists stay in `createdAt`
 * order because the query was ordered before this function ran.
 *
 * A reply whose parent isn't in the list (the parent was deleted between the
 * two queries, say) is promoted to top level rather than dropped — losing a
 * comment because its anchor vanished is worse than showing it unanchored.
 */
function nestReplies(comments: WorkItemCommentRow[]): WorkItemCommentNode[] {
  const nodes = new Map<string, WorkItemCommentNode>();
  for (const comment of comments) {
    nodes.set(comment.id, { ...comment, replies: [] });
  }

  const roots: WorkItemCommentNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id) as WorkItemCommentNode;
    const parent = comment.parentId ? nodes.get(comment.parentId) : null;
    if (parent && parent.id !== node.id) parent.replies.push(node);
    else roots.push(node);
  }

  return roots.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Raw reaction rows → per-comment, per-emoji tallies in catalog order. */
function summarizeReactions(
  rows: {
    commentId: string;
    emoji: string;
    memberId: string;
    name: string | null;
  }[],
  viewerMemberId: string | null,
): Map<string, CommentReactionSummary[]> {
  const byComment = new Map<string, Map<string, CommentReactionSummary>>();

  for (const row of rows) {
    let byEmoji = byComment.get(row.commentId);
    if (!byEmoji) {
      byEmoji = new Map();
      byComment.set(row.commentId, byEmoji);
    }
    let summary = byEmoji.get(row.emoji);
    if (!summary) {
      summary = { emoji: row.emoji, count: 0, reacted: false, names: [] };
      byEmoji.set(row.emoji, summary);
    }
    summary.count += 1;
    if (viewerMemberId !== null && row.memberId === viewerMemberId) {
      summary.reacted = true;
    }
    if (summary.names.length < REACTION_NAME_LIMIT) {
      summary.names.push(row.name ?? "Someone");
    }
  }

  const result = new Map<string, CommentReactionSummary[]>();
  for (const [commentId, byEmoji] of byComment) {
    const order = sortReactionEmojis([...byEmoji.keys()]);
    result.set(
      commentId,
      order.map((emoji) => byEmoji.get(emoji) as CommentReactionSummary),
    );
  }
  return result;
}

export async function createWorkItemComment(input: {
  workItemId: string;
  body: string;
  parentId?: string | null;
  mentionedMemberIds?: string[];
}): Promise<{ id: string }> {
  const parsed = createWorkItemCommentSchema.parse(input);
  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "comment:create",
    ORG_BYPASS,
    WRITE_DENIED,
  );
  await assertPlatformNotLocked();

  // The parent is resolved from storage and checked against THIS item: a
  // parentId is attacker-controlled, and without this a reply could be hung
  // off a comment in a project the caller can't see, dragging its author into
  // a thread they never joined.
  const parent = parsed.parentId
    ? await loadCommentOrThrow(parsed.parentId)
    : null;
  if (parent) {
    if (parent.workItemId !== item.id) {
      throw new Error("That comment belongs to a different work item.");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies only go one level deep.");
    }
  }

  const authorMemberId = await callerMemberId(
    item.organizationId,
    session.user.id,
  );
  // The assistant's sentinel rides in the same list as real mentions and must
  // be read BEFORE resolving: resolveMentions keeps only project members, and
  // would drop it silently.
  const askedAi = isAiMention(parsed.mentionedMemberIds);
  const mentioned = await resolveMentions(
    item.projectId,
    withoutAiMention(parsed.mentionedMemberIds),
  );

  const [created] = await db
    .insert(workItemComment)
    .values({
      organizationId: item.organizationId,
      projectId: item.projectId,
      workItemId: item.id,
      parentId: parent?.id ?? null,
      authorMemberId,
      authorId: session.user.id,
      authorName: session.user.name,
      authorEmail: session.user.email,
      body: parsed.body,
      mentionedMemberIds: mentioned,
    })
    .returning({ id: workItemComment.id });

  const key = workItemKey(item.projectKey, item.number);
  const preview = previewOf(parsed.body);

  await recordAudit({
    action: "workItemComment.created",
    organizationId: item.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: item.id,
    metadata: {
      commentId: created.id,
      parentId: parent?.id ?? null,
      key,
      projectId: item.projectId,
      mentionedMemberIds: mentioned,
    },
  });

  notifyThread({
    item,
    key,
    preview,
    mentioned,
    // Whoever you replied to is being addressed as directly as a mention, so
    // they get the bell even without an @ — but never twice, and never for
    // replying to yourself (scheduleNotifications drops the actor already).
    repliedToMemberId: parent?.authorMemberId ?? null,
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: authorMemberId,
    },
  });

  if (askedAi) {
    // Replies are one level deep, so an AI answer to a reply is posted beside
    // it under the top-level comment instead of becoming a grandchild.
    scheduleAiCommentReply({
      organizationId: item.organizationId,
      projectId: item.projectId,
      workItemId: item.id,
      triggerCommentId: created.id,
      parentId: parent?.id ?? created.id,
      question: parsed.body,
      askedBy: session.user.name,
      askedByMemberId: authorMemberId,
      itemKey: key,
      itemSummary: item.summary,
      projectKey: item.projectKey,
    });
  }

  scheduleCommentEmbedding(created.id, item.organizationId, parsed.body);
  publishRealtime({
    topic: workItemCommentsTopic(item.id),
    detail: { commentId: created.id, action: "created" },
  });
  revalidateItem();

  return { id: created.id };
}

export async function updateWorkItemComment(input: {
  commentId: string;
  body: string;
  mentionedMemberIds?: string[];
}): Promise<void> {
  const parsed = updateWorkItemCommentSchema.parse(input);
  const existing = await loadCommentOrThrow(parsed.commentId);
  // Editing is authorship, not a permission: comment:create is what says you
  // belong in this thread at all, and the author check below is what limits
  // the edit to your own words. Nobody edits someone else's — moderation can
  // remove a comment, never rewrite it.
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "comment:create",
    ORG_BYPASS,
    WRITE_DENIED,
  );
  await assertPlatformNotLocked();

  const viewerMemberId = await callerMemberId(
    existing.organizationId,
    session.user.id,
  );
  const isAuthor =
    existing.authorId === session.user.id ||
    (existing.authorMemberId !== null &&
      existing.authorMemberId === viewerMemberId);
  if (!isAuthor) throw new Error("You can only edit your own comments.");

  const mentioned = await resolveMentions(
    existing.projectId,
    parsed.mentionedMemberIds,
  );

  await db
    .update(workItemComment)
    .set({
      body: parsed.body,
      mentionedMemberIds: mentioned,
      editedAt: new Date(),
    })
    .where(eq(workItemComment.id, existing.id));

  const item = await loadWorkItemOrThrow(existing.workItemId);
  const key = workItemKey(item.projectKey, item.number);

  await recordAudit({
    action: "workItemComment.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.workItemId,
    metadata: {
      commentId: existing.id,
      key,
      projectId: existing.projectId,
      mentionedMemberIds: mentioned,
    },
  });

  // An edit never re-summons the assistant, even though the body still carries
  // its mention span: the question was already asked and answered, and a
  // typo fix that posts a second answer is how a thread fills with AI.
  //
  // Only the NEWLY mentioned are paged, for the same reason.
  const added = mentioned.filter(
    (id) => !existing.mentionedMemberIds.includes(id),
  );
  if (added.length > 0) {
    scheduleNotifications({
      organizationId: existing.organizationId,
      recipientMemberIds: added,
      actor: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        memberId: viewerMemberId,
      },
      action: "workItem.mentioned",
      targetType: "workItem",
      targetId: existing.workItemId,
      metadata: {
        key,
        summary: item.summary,
        projectKey: item.projectKey,
        commentId: existing.id,
        preview: previewOf(parsed.body),
      },
    });
  }

  scheduleCommentEmbedding(existing.id, existing.organizationId, parsed.body);
  publishRealtime({
    topic: workItemCommentsTopic(existing.workItemId),
    detail: { commentId: existing.id, action: "updated" },
  });
  revalidateItem();
}

export async function deleteWorkItemComment(input: {
  commentId: string;
}): Promise<void> {
  const parsed = deleteWorkItemCommentSchema.parse(input);
  const existing = await loadCommentOrThrow(parsed.commentId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );
  await assertPlatformNotLocked();

  const viewerMemberId = await callerMemberId(
    existing.organizationId,
    session.user.id,
  );
  const abilities = await callerCommentAbilities(
    existing.organizationId,
    existing.projectId,
    session.user.id,
  );
  const isAuthor =
    existing.authorId === session.user.id ||
    (existing.authorMemberId !== null &&
      existing.authorMemberId === viewerMemberId);
  if (!isAuthor && !abilities.canModerate) {
    throw new Error("You can only delete your own comments.");
  }

  // A hard delete, not a tombstone: a "deleted comment" placeholder carries no
  // information the audit trail doesn't already hold — which is where the
  // record belongs. Replies and reactions go with it via ON DELETE CASCADE,
  // so a thread can't be left pointing at a parent that isn't there.
  await db.delete(workItemComment).where(eq(workItemComment.id, existing.id));

  await recordAudit({
    action: "workItemComment.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.workItemId,
    metadata: {
      commentId: existing.id,
      parentId: existing.parentId,
      projectId: existing.projectId,
      // Kept so the trail still says WHAT was removed once the row is gone.
      preview: previewOf(existing.body),
      moderated: !isAuthor,
    },
  });

  publishRealtime({
    topic: workItemCommentsTopic(existing.workItemId),
    detail: { commentId: existing.id, action: "deleted" },
  });
  revalidateItem();
}

/**
 * Add or remove the caller's one emoji on one comment.
 *
 * A toggle rather than separate add/remove calls: the unique index
 * (commentId, memberId, emoji) already makes "reacted or not" a single fact,
 * and two endpoints would let a double-click leave the UI and the row
 * disagreeing about which one to call next.
 *
 * Reacting is participating, so it needs comment:create — a Viewer who cannot
 * post cannot react either. No notification: a reaction is the lightest signal
 * in the system and paging someone for one is how a bell becomes noise people
 * stop reading. It IS audited, like every other state change.
 */
export async function toggleWorkItemCommentReaction(input: {
  commentId: string;
  emoji: string;
}): Promise<{ reacted: boolean }> {
  const parsed = toggleCommentReactionSchema.parse(input);
  const existing = await loadCommentOrThrow(parsed.commentId);
  const session = await requireProjectPermission(
    existing.organizationId,
    existing.projectId,
    "comment:create",
    ORG_BYPASS,
    WRITE_DENIED,
  );
  await assertPlatformNotLocked();

  const viewerMemberId = await callerMemberId(
    existing.organizationId,
    session.user.id,
  );
  if (!viewerMemberId) {
    throw new Error("You aren't a member of this organization.");
  }

  const mine = and(
    eq(workItemCommentReaction.commentId, existing.id),
    eq(workItemCommentReaction.memberId, viewerMemberId),
    eq(workItemCommentReaction.emoji, parsed.emoji),
  );

  const removed = await db
    .delete(workItemCommentReaction)
    .where(mine)
    .returning({ id: workItemCommentReaction.id });
  const reacted = removed.length === 0;

  if (reacted) {
    await db
      .insert(workItemCommentReaction)
      .values({
        organizationId: existing.organizationId,
        commentId: existing.id,
        memberId: viewerMemberId,
        emoji: parsed.emoji,
      })
      // Two rapid clicks can both find nothing to delete; the unique index is
      // what actually decides, and the second one is a no-op rather than a
      // 23505 surfacing as "something went wrong".
      .onConflictDoNothing();
  }

  await recordAudit({
    action: reacted ? "workItemComment.reacted" : "workItemComment.unreacted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "workItem",
    targetId: existing.workItemId,
    metadata: {
      commentId: existing.id,
      projectId: existing.projectId,
      emoji: parsed.emoji,
    },
  });

  publishRealtime({
    topic: workItemCommentsTopic(existing.workItemId),
    detail: { commentId: existing.id, action: "reacted" },
  });
  revalidateItem();

  return { reacted };
}

type StoredComment = {
  id: string;
  organizationId: string;
  projectId: string;
  workItemId: string;
  parentId: string | null;
  authorMemberId: string | null;
  authorId: string | null;
  body: string;
  mentionedMemberIds: string[];
};

/**
 * A comment id is attacker-controlled, so scope comes from the STORED row —
 * the org and project on the comment itself, never from anything the client
 * paired with the id.
 */
async function loadCommentOrThrow(commentId: string): Promise<StoredComment> {
  const [row] = await db
    .select({
      id: workItemComment.id,
      organizationId: workItemComment.organizationId,
      projectId: workItemComment.projectId,
      workItemId: workItemComment.workItemId,
      parentId: workItemComment.parentId,
      authorMemberId: workItemComment.authorMemberId,
      authorId: workItemComment.authorId,
      body: workItemComment.body,
      mentionedMemberIds: workItemComment.mentionedMemberIds,
    })
    .from(workItemComment)
    .where(eq(workItemComment.id, commentId))
    .limit(1);
  if (!row) throw new Error("Comment not found.");
  return { ...row, mentionedMemberIds: row.mentionedMemberIds ?? [] };
}

/** The caller's `member` row in this org. */
async function callerMemberId(organizationId: string, userId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * The two comment permissions, resolved the same way requireProjectPermission
 * resolves one: org owners/admins hold both by bypass, everyone else needs the
 * key on their project role.
 */
async function callerCommentAbilities(
  organizationId: string,
  projectId: string,
  userId: string,
): Promise<{
  canComment: boolean;
  canModerate: boolean;
  canAttach: boolean;
}> {
  const permissions = await loadCallerProjectPermissions(
    organizationId,
    projectId,
    userId,
  );
  const canComment = projectRoleCan(permissions, "comment:create");
  const canModerate = projectRoleCan(permissions, "comment:moderate");
  // Pasting a screenshot into a comment writes a real attachment row on the
  // item, so it answers to `attachment:create` — the same key the Attachments
  // tab and a drop on Description answer to. Someone who may discuss an item
  // but not add files to it keeps a composer that takes words only.
  const canAttach = projectRoleCan(permissions, "attachment:create");
  if (canComment && canModerate && canAttach) {
    return { canComment, canModerate, canAttach };
  }

  // Only pay for the Better Auth round-trip when the project role didn't
  // already answer yes.
  const bypass = await hasOrgPermission(organizationId, ORG_BYPASS);
  return {
    canComment: canComment || bypass,
    canModerate: canModerate || bypass,
    canAttach: canAttach || bypass,
  };
}

/**
 * Mention ids from the client, narrowed to people who are actually on this
 * project. A mention is a notification trigger, so an unfiltered list would be
 * a way to page anyone in the org — or to confirm that an id exists.
 */
async function resolveMentions(
  projectId: string,
  candidates: string[],
): Promise<string[]> {
  if (candidates.length === 0) return [];

  const rows = await db
    .select({ memberId: projectMember.memberId })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        inArray(projectMember.memberId, candidates),
      ),
    );
  return rows.map((row) => row.memberId);
}

/**
 * Three tiers, in descending directness, each recipient hearing about it once.
 *
 * Someone @-mentioned is being asked a question. Someone replied to is being
 * answered — as direct as a mention, so it uses the same action string rather
 * than inventing a fourth sentence for the bell. The assignee and reporter are
 * merely being kept informed. Collapsing these would make all three read the
 * same, so the more direct tier wins and the looser ones skip whoever it
 * already covered.
 */
function notifyThread(input: {
  item: StoredWorkItem;
  key: string;
  preview: string;
  mentioned: string[];
  repliedToMemberId?: string | null;
  actor: {
    id: string;
    name: string;
    email: string;
    memberId: string | null;
  };
}): void {
  const item = input.item;

  const metadata = {
    key: input.key,
    summary: item.summary,
    projectKey: item.projectKey,
    preview: input.preview,
  };

  const direct = [...input.mentioned];
  if (input.repliedToMemberId && !direct.includes(input.repliedToMemberId)) {
    direct.push(input.repliedToMemberId);
  }

  if (direct.length > 0) {
    scheduleNotifications({
      organizationId: item.organizationId,
      recipientMemberIds: direct,
      actor: input.actor,
      action: "workItem.mentioned",
      targetType: "workItem",
      targetId: item.id,
      metadata,
    });
  }

  const followers = [item.assigneeMemberId, item.reporterMemberId].filter(
    (id): id is string => !!id && !direct.includes(id),
  );
  if (followers.length > 0) {
    scheduleNotifications({
      organizationId: item.organizationId,
      recipientMemberIds: followers,
      actor: input.actor,
      action: "workItem.commented",
      targetType: "workItem",
      targetId: item.id,
      metadata,
    });
  }
}

/** Comment prose is searchable by meaning, so it carries an embedding too. */
function scheduleCommentEmbedding(
  commentId: string,
  organizationId: string,
  body: string,
): void {
  scheduleEmbedding({
    organizationId,
    // The markdown source would embed its own syntax; the sentence is what
    // someone searches for.
    text: markdownToPlainText(body),
    persist: async (result) => {
      await db
        .update(workItemComment)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(workItemComment.id, commentId));
    },
  });
}

/** One line of the comment, for a bell that has no room for the document. */
function previewOf(body: string): string {
  const text = markdownToPlainText(body);
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}
