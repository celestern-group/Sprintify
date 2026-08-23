import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  project,
  user,
  workflowStatus,
  workItem,
  workItemComment,
  workItemType,
} from "@/db/schema";
import type { CommentItemContext, CommentTurn } from "@/lib/ai/comment-prompts";
import { AI_AUTHOR_NAME } from "@/lib/comment-authors";
import { markdownToPlainText } from "@/lib/markdown";
import { workItemKey } from "@/lib/work-items";

// What the comment thread's AI features read before they prompt.
//
// A plain server-only module rather than part of the actions file: the
// assistant's own reply runs from `after()`, outside any request, and a
// "use server" module may only export async functions that are safe to expose
// as endpoints. These take an organizationId as a parameter — exposing them
// would be handing anyone a way to spend someone else's provider budget.

/** How much of the thread a model sees — the newest turns, oldest dropped. */
const THREAD_TURN_LIMIT = 60;

/** The item's own caption, so the assistant knows what is being discussed. */
export async function commentItemContext(
  workItemId: string,
): Promise<CommentItemContext> {
  const [row] = await db
    .select({
      number: workItem.number,
      summary: workItem.summary,
      description: workItem.description,
      typeName: workItemType.name,
      statusName: workflowStatus.name,
      projectKey: project.key,
    })
    .from(workItem)
    .innerJoin(project, eq(workItem.projectId, project.id))
    .innerJoin(workItemType, eq(workItem.typeId, workItemType.id))
    .leftJoin(workflowStatus, eq(workItem.statusId, workflowStatus.id))
    .where(eq(workItem.id, workItemId))
    .limit(1);

  if (!row) throw new Error("Work item not found.");

  return {
    key: workItemKey(row.projectKey, row.number),
    summary: row.summary,
    typeName: row.typeName,
    statusName: row.statusName,
    // Plain text, not markdown: stored prose can carry raw HTML, and there is
    // no reason to hand a model markup it will only try to imitate.
    description: row.description ? markdownToPlainText(row.description) : null,
  };
}

/**
 * The thread as attributed plain-text turns, oldest first, each reply naming
 * what it answers — the order and the shape a person reads it in.
 */
export async function loadCommentTurns(
  workItemId: string,
): Promise<CommentTurn[]> {
  const rows = await db
    .select({
      id: workItemComment.id,
      parentId: workItemComment.parentId,
      authorKind: workItemComment.authorKind,
      userName: user.name,
      authorName: workItemComment.authorName,
      body: workItemComment.body,
      createdAt: workItemComment.createdAt,
    })
    .from(workItemComment)
    .leftJoin(user, eq(workItemComment.authorId, user.id))
    .where(eq(workItemComment.workItemId, workItemId))
    .orderBy(asc(workItemComment.createdAt));

  const nameById = new Map(
    rows.map((row) => [row.id, commentAuthorLabel(row)] as const),
  );

  return rows.slice(-THREAD_TURN_LIMIT).map((row) => ({
    author: commentAuthorLabel(row),
    createdAt: row.createdAt,
    text: markdownToPlainText(row.body),
    replyingTo: row.parentId ? (nameById.get(row.parentId) ?? null) : null,
  }));
}

export function commentAuthorLabel(row: {
  authorKind: string;
  userName?: string | null;
  authorName: string | null;
}): string {
  if (row.authorKind === "ai") return AI_AUTHOR_NAME;
  return row.userName ?? row.authorName ?? "A removed user";
}

/** Who wrote one comment, when it belongs to this item. */
export async function commentAuthorOf(
  commentId: string,
  workItemId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      workItemId: workItemComment.workItemId,
      authorKind: workItemComment.authorKind,
      userName: user.name,
      authorName: workItemComment.authorName,
    })
    .from(workItemComment)
    .leftJoin(user, eq(workItemComment.authorId, user.id))
    .where(eq(workItemComment.id, commentId))
    .limit(1);

  // A parent from another item is context we simply don't add, rather than an
  // error — it can't leak, because it never reaches the prompt.
  if (!row || row.workItemId !== workItemId) return null;
  return commentAuthorLabel(row);
}
