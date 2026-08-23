"use server";

import type { AiTextOperation } from "@/lib/ai/assist-operations";
import { AiNotConfiguredError } from "@/lib/ai/client";
import {
  COMMENT_PROSE_SYSTEM,
  COMMENT_REPLY_SYSTEM,
  COMMENT_SUMMARY_SYSTEM,
  type CommentSummary,
  commentReplyPrompt,
  commentRewritePrompt,
  commentSummaryPrompt,
  commentSummarySchema,
} from "@/lib/ai/comment-prompts";
import {
  commentAuthorOf,
  commentItemContext,
  loadCommentTurns,
} from "@/lib/ai/comment-thread-context";
import {
  AiTextUnavailableError,
  generateObject,
  generateText,
} from "@/lib/ai/text";
import { textOperationInstruction } from "@/lib/ai/work-item-prompts";
import { recordAudit } from "@/lib/audit";
import { requireProjectPermission } from "@/lib/project-access";
import {
  assistCommentTextSchema,
  suggestCommentReplySchema,
  summarizeCommentThreadSchema,
} from "@/lib/validation/comment-ai";
import { loadWorkItemOrThrow } from "@/lib/work-item-access";

// The comment thread's AI layer.
//
// Same two rules as the backlog's AI actions (src/lib/actions/ai-assist.ts):
// scope comes from the STORED row, and "AI isn't usable right now" is a VALUE
// ({ ok: false, message }), not an exception — permission and validation
// failures still throw.
//
// One rule of its own: everything here reads text OTHER people wrote. The
// prompts fence the thread and declare it data (see comment-prompts.ts), and
// the thread is flattened to plain text before it goes near a model.

const ORG_BYPASS: Record<string, string[]> = { project: ["update"] };
const VIEW_DENIED = "You don't have permission to view this project's backlog.";
const WRITE_DENIED = "You don't have permission to comment on this project.";

export type AiFailure = { ok: false; message: string };
export type AiResult<T> = ({ ok: true } & T) | AiFailure;

/** Turns the two "AI isn't usable" errors into a value; anything else throws. */
async function runAi<R extends { ok: boolean }>(
  work: () => Promise<R>,
): Promise<R | AiFailure> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof AiNotConfiguredError ||
      error instanceof AiTextUnavailableError
    ) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/**
 * Rewrite the author's OWN unposted draft.
 *
 * Gated on comment:create rather than item:update, unlike the field-level
 * assist: this produces a comment, and someone who may comment but not edit
 * the item is exactly who it is for. It never reads the thread — a draft is
 * yours alone until you post it.
 */
export async function assistCommentText(input: {
  workItemId: string;
  operation: AiTextOperation;
  text: string;
  instruction?: string | null;
}): Promise<AiResult<{ text: string }>> {
  const parsed = assistCommentTextSchema.parse(input);
  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "comment:create",
    ORG_BYPASS,
    WRITE_DENIED,
  );

  return runAi(async () => {
    const context = await commentItemContext(item.id);
    const text = await generateText({
      organizationId: item.organizationId,
      system: COMMENT_PROSE_SYSTEM,
      prompt: commentRewritePrompt({
        text: parsed.text,
        instruction: textOperationInstruction(
          parsed.operation,
          parsed.instruction,
        ),
        item: context,
      }),
      maxTokens: 1500,
    });

    await recordAudit({
      action: "workItemComment.aiAssisted",
      organizationId: item.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: item.id,
      // The prose itself is deliberately not stored: the trail records that AI
      // touched a draft, not a second copy of it.
      metadata: {
        projectId: item.projectId,
        operation: parsed.operation,
        inputChars: parsed.text.length,
        outputChars: text.length,
      },
    });

    return { ok: true as const, text };
  });
}

/**
 * "Catch me up" — the thread, summarised for someone who hasn't read it.
 *
 * Reading-shaped, so backlog:view is enough. The result is EPHEMERAL: returned
 * and rendered, never stored. A cached summary goes stale the moment anyone
 * replies, and a stale summary of a discussion is worse than none.
 */
export async function summarizeCommentThread(input: {
  workItemId: string;
}): Promise<AiResult<{ summary: CommentSummary }>> {
  const parsed = summarizeCommentThreadSchema.parse(input);
  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  return runAi(async () => {
    const [context, turns] = await Promise.all([
      commentItemContext(item.id),
      loadCommentTurns(item.id),
    ]);
    if (turns.length === 0) {
      return {
        ok: false as const,
        message: "There's nothing to summarise yet.",
      };
    }

    const summary = await generateObject({
      organizationId: item.organizationId,
      system: COMMENT_SUMMARY_SYSTEM,
      prompt: commentSummaryPrompt({ item: context, turns }),
      schema: commentSummarySchema,
      maxTokens: 1200,
    });

    await recordAudit({
      action: "workItemComment.aiSummarized",
      organizationId: item.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: item.id,
      metadata: { projectId: item.projectId, turns: turns.length },
    });

    return { ok: true as const, summary };
  });
}

/**
 * Draft the caller's next comment, in their voice, for them to edit.
 *
 * Deliberately does NOT post — it lands in the composer. An assistant that
 * publishes into a human discussion under a human's name turns a thread into
 * something nobody can trust the attribution of. (The @-mention assistant DOES
 * post, but under its own name; see src/lib/ai/comment-replies.ts.)
 */
export async function suggestCommentReply(input: {
  workItemId: string;
  parentId?: string | null;
  instruction?: string | null;
}): Promise<AiResult<{ text: string }>> {
  const parsed = suggestCommentReplySchema.parse(input);
  const item = await loadWorkItemOrThrow(parsed.workItemId);
  const session = await requireProjectPermission(
    item.organizationId,
    item.projectId,
    "comment:create",
    ORG_BYPASS,
    WRITE_DENIED,
  );

  return runAi(async () => {
    const [context, turns, replyingTo] = await Promise.all([
      commentItemContext(item.id),
      loadCommentTurns(item.id),
      parsed.parentId
        ? commentAuthorOf(parsed.parentId, item.id)
        : Promise.resolve(null),
    ]);
    if (turns.length === 0) {
      return {
        ok: false as const,
        message: "There's no discussion to reply to yet.",
      };
    }

    const text = await generateText({
      organizationId: item.organizationId,
      system: COMMENT_REPLY_SYSTEM,
      prompt: commentReplyPrompt({
        item: context,
        turns,
        authorName: session.user.name,
        instruction: parsed.instruction,
        replyingTo,
      }),
      maxTokens: 1000,
    });

    await recordAudit({
      action: "workItemComment.aiReplyDrafted",
      organizationId: item.organizationId,
      actor: { id: session.user.id, email: session.user.email },
      targetType: "workItem",
      targetId: item.id,
      metadata: {
        projectId: item.projectId,
        parentId: parsed.parentId ?? null,
        turns: turns.length,
        outputChars: text.length,
      },
    });

    return { ok: true as const, text };
  });
}
