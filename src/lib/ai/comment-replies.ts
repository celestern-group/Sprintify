import "server-only";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { db } from "@/db";
import { workItemComment } from "@/db/schema";
import { tryGetAiClient } from "@/lib/ai/client";
import {
  COMMENT_ANSWER_SYSTEM,
  commentAnswerPrompt,
} from "@/lib/ai/comment-prompts";
import {
  commentItemContext,
  loadCommentTurns,
} from "@/lib/ai/comment-thread-context";
import { generateText } from "@/lib/ai/text";
import { recordAudit } from "@/lib/audit";
import { AI_AUTHOR_NAME } from "@/lib/comment-authors";
import { markdownToPlainText } from "@/lib/markdown";
import { scheduleNotifications } from "@/lib/notifications";
import { publishRealtime, workItemCommentsTopic } from "@/lib/realtime";

// The assistant's own turn in a thread.
//
// Runs post-response via `after()`, like scheduleEmbedding: the person who
// asked should see their own comment land immediately, not wait on a provider
// round-trip. Best-effort with the same contract as recordAudit — it never
// throws, because a model being unreachable must not fail the comment that
// triggered it.
//
// Attribution is the whole design constraint. The reply is stored with
// authorKind "ai", no member and no user, and renders under the assistant's
// own name — so no human is ever shown as having written something they did
// not. That is also why this is the ONLY path that posts AI text: the
// suggest-a-reply action hands its draft to the composer instead.

/**
 * Two guards against a thread that answers itself:
 *
 *  - the assistant never replies to its OWN comment (checked by the caller,
 *    which only schedules this for authorKind "human"), and
 *  - it posts at most one reply per triggering comment, because there is
 *    exactly one call site and it runs once.
 *
 * Together those make a loop impossible without a rate limiter, which is worth
 * more than a rate limiter would be.
 */
export function scheduleAiCommentReply(input: {
  organizationId: string;
  projectId: string;
  workItemId: string;
  /** The comment that mentioned the assistant. */
  triggerCommentId: string;
  /**
   * Where the answer hangs. This is the comment that mentioned the assistant,
   * regardless of its depth in the thread.
   */
  parentId: string | null;
  question: string;
  askedBy: string;
  /** The asker's member row, so they get the bell for the answer. */
  askedByMemberId: string | null;
  /** For the deep link on that notification. */
  itemKey: string;
  itemSummary: string;
  projectKey: string;
}): void {
  after(async () => {
    try {
      const [context, turns] = await Promise.all([
        commentItemContext(input.workItemId),
        loadCommentTurns(input.workItemId),
      ]);

      const body = await generateText({
        organizationId: input.organizationId,
        system: COMMENT_ANSWER_SYSTEM,
        prompt: commentAnswerPrompt({
          item: context,
          turns,
          question: input.question,
          askedBy: input.askedBy,
        }),
        maxTokens: 1200,
      });

      const trimmed = body.trim();
      if (!trimmed) return;

      // Recorded for provenance, not used to generate: the call above already
      // resolved the org's provider, and this only asks what it was.
      const model = (await tryGetAiClient(input.organizationId))?.models.text;

      const [created] = await db
        .insert(workItemComment)
        .values({
          organizationId: input.organizationId,
          projectId: input.projectId,
          workItemId: input.workItemId,
          parentId: input.parentId,
          authorKind: "ai",
          aiModel: model ?? null,
          // No member, no user, no email — the assistant is not a person and
          // must not borrow one's identity anywhere in the row.
          authorMemberId: null,
          authorId: null,
          authorName: AI_AUTHOR_NAME,
          authorEmail: null,
          body: trimmed,
          // The assistant never @-mentions anyone. Letting it would give any
          // author a way to page the whole project through it.
          mentionedMemberIds: [],
        })
        .returning({ id: workItemComment.id });

      await recordAudit({
        action: "workItemComment.aiReplied",
        // This assistant reply already runs inside Next's `after()` callback.
        // Send analytics from this callback rather than nesting another one.
        analyticsDelivery: "immediate",
        organizationId: input.organizationId,
        // No actor: nobody performed this write. The metadata names who
        // triggered it, which is the honest record.
        actor: null,
        targetType: "workItem",
        targetId: input.workItemId,
        metadata: {
          projectId: input.projectId,
          commentId: created.id,
          triggerCommentId: input.triggerCommentId,
          model: model ?? null,
          outputChars: trimmed.length,
        },
      });

      // Only the person who asked. The assistant answering is not news to the
      // assignee and reporter — a thread where every AI turn pages three
      // people is a thread people mute.
      scheduleNotifications({
        organizationId: input.organizationId,
        recipientMemberIds: [input.askedByMemberId],
        // No actor member id, so the asker is NOT filtered out — they are
        // exactly who this is for.
        actor: { id: null, name: AI_AUTHOR_NAME, email: null },
        action: "workItem.commented",
        targetType: "workItem",
        targetId: input.workItemId,
        metadata: {
          key: input.itemKey,
          summary: input.itemSummary,
          projectKey: input.projectKey,
          preview: previewOf(trimmed),
        },
      });

      publishRealtime({
        topic: workItemCommentsTopic(input.workItemId),
        detail: { commentId: created.id, action: "created" },
      });
    } catch (error) {
      // Includes AiNotConfiguredError: an org with no provider simply gets no
      // answer, which is the correct outcome and not worth an alert of its
      // own — Sentry keeps the detail either way.
      Sentry.captureException(error);
    }
  });
}

/** One line of the answer, for a bell that has no room for the document. */
function previewOf(body: string): string {
  const text = markdownToPlainText(body);
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}
