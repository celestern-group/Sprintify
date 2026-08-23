"use client";

import {
  IconCornerDownRight,
  IconDotsVertical,
  IconPencil,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import type { Editor } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AiAssistMenu } from "@/components/app/backlog/ai-assist-menu";
import {
  type AttachmentUploader,
  useAttachmentUploader,
} from "@/components/app/backlog/attachment-dropzone";
import {
  CommentEditor,
  commentProseStyles,
} from "@/components/app/backlog/comment-editor";
import { CommentProse } from "@/components/app/backlog/comment-prose";
import { CommentReactionBar } from "@/components/app/backlog/comment-reaction-bar";
import { CommentSummaryPanel } from "@/components/app/backlog/comment-summary-panel";
import { UserGlimpse } from "@/components/app/user-glimpse";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RelativeTime } from "@/components/ui/relative-time";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  assistCommentText,
  suggestCommentReply,
} from "@/lib/actions/comment-ai";
import {
  createWorkItemComment,
  deleteWorkItemComment,
  getWorkItemCommentThread,
  toggleWorkItemCommentReaction,
  updateWorkItemComment,
  type WorkItemCommentNode,
  type WorkItemCommentRow,
  type WorkItemCommentThread,
} from "@/lib/actions/work-item-comments";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import { mentionedMemberIdsIn } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/work-items";

/**
 * The item's comment thread — oldest first, composer at the bottom, live.
 *
 * "Live" here is a re-read, not a push of rows: the SSE stream
 * (/api/work-items/[id]/comments/stream) only says THAT the thread changed,
 * and this component then calls getWorkItemCommentThread, which re-checks the
 * caller's permissions. A long-lived connection outlives the authorization
 * that opened it, so nothing that could go stale travels down it.
 *
 * Layout: each comment is a bordered surface on the canvas, not a bare row.
 * The earlier flat list had nothing but whitespace separating one person's
 * words from the next, which made a thread read as one run-on document —
 * exactly the failure a discussion surface cannot afford. Replies sit inside
 * their parent's card on an indented rail, so "this is an answer to that" is
 * carried by containment rather than by a margin you have to measure by eye.
 */
export function ItemComments({
  workItemId,
  initial,
  members,
  onCountChange,
}: {
  workItemId: string;
  initial: WorkItemCommentThread;
  /** The project's membership — the @-mention menu's candidates. */
  members: BacklogMemberRow[];
  /**
   * Reports the live comment count up to the tab label. The thread's state
   * lives here, so without this the count beside "Comments" would keep
   * showing whatever the page was server-rendered with — a stale number next
   * to a list that just moved reads as broken.
   */
  onCountChange?: (count: number) => void;
}) {
  const [thread, setThread] = useState(initial);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const composerRef = useRef<Editor | null>(null);
  const router = useRouter();

  /**
   * A screenshot pasted into a composer is an attachment on the ITEM, filed
   * under Comments — so the Attachments tab has to hear about it. The tab is
   * server-rendered, hence a route refresh rather than local state; the thread
   * itself needs no refresh, since the picture is written straight into the
   * draft the person is still typing.
   */
  const uploader = useAttachmentUploader({
    workItemId,
    canUpload: thread.canAttach && thread.canComment,
    onUploaded: () => router.refresh(),
  });

  const refresh = useCallback(async () => {
    try {
      const next = await getWorkItemCommentThread({ workItemId });
      setThread(next);
    } catch {
      // A refused read means access changed under us — the next navigation
      // renders the real answer; overwriting the thread with nothing here
      // would just blank it.
    }
  }, [workItemId]);

  useCommentStream(workItemId, refresh);

  // Server-rendered props win on navigation: a fresh page load carries newer
  // data than whatever this component last fetched.
  useEffect(() => {
    setThread(initial);
  }, [initial]);

  const count = thread.totalCount;
  useEffect(() => {
    onCountChange?.(count);
  }, [count, onCountChange]);

  /** One place for the post/reply write, since only `parentId` differs. */
  function submit(body: string, parentId: string | null, done: () => void) {
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await createWorkItemComment({
          workItemId,
          body: trimmed,
          parentId,
          mentionedMemberIds: mentionedMemberIdsIn(trimmed),
        });
        done();
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't post the comment.",
        );
      }
    });
  }

  function saveEdit(commentId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await updateWorkItemComment({
          commentId,
          body: trimmed,
          mentionedMemberIds: mentionedMemberIdsIn(trimmed),
        });
        setEditingId(null);
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't save the edit.",
        );
      }
    });
  }

  function remove(commentId: string) {
    startTransition(async () => {
      try {
        await deleteWorkItemComment({ commentId });
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't delete the comment.",
        );
      }
    });
  }

  /**
   * Push markdown into the composer's DOCUMENT, not just into `draft`. The
   * editor is uncontrolled — it was seeded once — so setting state alone would
   * leave what's on screen unchanged while the button thought it had text.
   */
  function setDraftInEditor(
    markdown: string,
    mode: "replace" | "append" = "replace",
  ) {
    const next =
      mode === "append" && draft.trim()
        ? `${draft.trim()}\n\n${markdown}`
        : markdown;
    composerRef.current?.commands.setContent(next);
    setDraft(next);
  }

  function react(commentId: string, emoji: string) {
    startTransition(async () => {
      try {
        await toggleWorkItemCommentReaction({ commentId, emoji });
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't react.");
      }
    });
  }

  const abilities = {
    viewerMemberId: thread.viewerMemberId,
    canComment: thread.canComment,
    canModerate: thread.canModerate,
    aiEnabled: thread.aiEnabled,
    attach: uploader.enabled ? uploader : undefined,
    pending,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Above the thread, not inside it: a summary is a way IN to the
          discussion, and it is worth least once you have already scrolled
          past everything it summarises. Only offered from a few comments up —
          "catch me up" on two lines is a slower way to read two lines. */}
      {thread.aiEnabled && thread.totalCount >= 3 ? (
        <CommentSummaryPanel workItemId={workItemId} />
      ) : null}

      {thread.comments.length === 0 ? (
        <div className="rounded-[11px] border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {thread.canComment
              ? "No comments yet. Start the discussion — type @ to bring someone in."
              : "No comments yet, and you don't have permission to add one."}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {thread.comments.map((node) => (
            <CommentThread
              abilities={abilities}
              editingId={editingId}
              key={node.id}
              members={members}
              node={node}
              onCancelEdit={() => setEditingId(null)}
              onCancelReply={() => setReplyingTo(null)}
              onDelete={remove}
              onEdit={setEditingId}
              onReact={react}
              onReply={setReplyingTo}
              onSaveEdit={saveEdit}
              onSubmitReply={(body, parentId) =>
                submit(body, parentId, () => setReplyingTo(null))
              }
              replyingTo={replyingTo}
            />
          ))}
        </ol>
      )}

      {thread.canComment ? (
        <div className="flex flex-col gap-2 rounded-[11px] border border-border bg-card p-3 shadow-card">
          <CommentEditor
            aiEnabled={thread.aiEnabled}
            ariaLabel="Write a comment"
            attach={abilities.attach}
            editorRef={composerRef}
            members={members}
            onChange={setDraft}
            placeholder={
              thread.aiEnabled
                ? "Write a comment… type @ to mention someone, or @Sprintify AI to ask"
                : "Write a comment… type @ to mention someone"
            }
            toolbar={
              thread.aiEnabled ? (
                <CommentAiToolbar
                  draft={draft}
                  onReplace={setDraftInEditor}
                  workItemId={workItemId}
                />
              ) : null
            }
            value=""
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={pending || !draft.trim()}
              onClick={() =>
                submit(draft, null, () => {
                  setDraft("");
                  composerRef.current?.commands.clearContent();
                })
              }
            >
              {pending ? <Spinner className="size-4" /> : null}
              Comment
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Abilities = {
  /** The item's uploader, or undefined when this reader may not attach. */
  attach: AttachmentUploader | undefined;
  viewerMemberId: string | null;
  canComment: boolean;
  canModerate: boolean;
  aiEnabled: boolean;
  pending: boolean;
};

/**
 * The AI controls above a composer: rewrite what you've written, or draft the
 * next comment from the thread.
 *
 * Both land in the editor for you to edit; neither posts. That is the line
 * this feature does not cross — text published under a person's name has to
 * be text they chose to publish. The assistant posts only under its OWN name,
 * and only when @-mentioned.
 */
function CommentAiToolbar({
  workItemId,
  draft,
  parentId,
  onReplace,
}: {
  workItemId: string;
  draft: string;
  /** Set on a reply composer, so the draft answers that comment. */
  parentId?: string | null;
  onReplace: (markdown: string, mode?: "replace" | "append") => void;
}) {
  const [suggesting, startSuggest] = useTransition();

  function suggest() {
    startSuggest(async () => {
      try {
        const result = await suggestCommentReply({ workItemId, parentId });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        onReplace(result.text);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't draft a reply.",
        );
      }
    });
  }

  return (
    <>
      <Button
        className="h-7 gap-1.5 px-2 text-xs text-brand"
        disabled={suggesting}
        onClick={suggest}
        size="sm"
        type="button"
        variant="ghost"
      >
        {suggesting ? (
          <Spinner className="size-3.5" />
        ) : (
          <IconSparkles className="size-3.5" />
        )}
        Draft a reply
      </Button>
      <AiAssistMenu
        fieldLabel="Comment"
        onApply={(markdown, mode) => onReplace(markdown, mode)}
        // No projectId: the action below resolves the project from the work
        // item, and it is gated on comment:create rather than item:update.
        runAssist={(input) =>
          assistCommentText({
            workItemId,
            operation: input.operation,
            text: input.text,
            instruction: input.instruction,
          })
        }
        targetNoun="Comment"
        value={draft}
      />
    </>
  );
}

/** One top-level comment, its replies, and the reply composer. */
function CommentThread({
  node,
  members,
  abilities,
  editingId,
  replyingTo,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReact,
  onReply,
  onCancelReply,
  onSubmitReply,
}: {
  node: WorkItemCommentNode;
  members: BacklogMemberRow[];
  abilities: Abilities;
  editingId: string | null;
  replyingTo: string | null;
  onEdit: (commentId: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
  onReact: (commentId: string, emoji: string) => void;
  onReply: (commentId: string) => void;
  onCancelReply: () => void;
  onSubmitReply: (body: string, parentId: string) => void;
}) {
  const replying = replyingTo === node.id;

  return (
    <li className="rounded-[11px] border border-border bg-card p-3 shadow-card">
      <CommentBody
        abilities={abilities}
        comment={node}
        editing={editingId === node.id}
        members={members}
        onCancelEdit={onCancelEdit}
        onDelete={() => onDelete(node.id)}
        onEdit={() => onEdit(node.id)}
        onReact={(emoji) => onReact(node.id, emoji)}
        onReply={() => onReply(node.id)}
        onSaveEdit={(body) => onSaveEdit(node.id, body)}
      />

      {node.replies.length > 0 || replying ? (
        // The rail, not an indent alone: a 2px border down the left is what
        // makes "these belong to the comment above" survive a reply long
        // enough to wrap, where a margin stops reading as a relationship.
        <div className="mt-3 flex flex-col gap-3 border-l-2 border-border pl-3 sm:pl-4">
          {node.replies.map((reply) => (
            <CommentBody
              abilities={abilities}
              comment={reply}
              compact
              editing={editingId === reply.id}
              key={reply.id}
              members={members}
              onCancelEdit={onCancelEdit}
              onDelete={() => onDelete(reply.id)}
              onEdit={() => onEdit(reply.id)}
              onReact={(emoji) => onReact(reply.id, emoji)}
              onSaveEdit={(body) => onSaveEdit(reply.id, body)}
            />
          ))}

          {replying ? (
            <CommentComposer
              aiEnabled={abilities.aiEnabled}
              ariaLabel={`Reply to ${displayName(node)}`}
              attach={abilities.attach}
              members={members}
              onCancel={onCancelReply}
              onSubmit={(body) => onSubmitReply(body, node.id)}
              parentId={node.id}
              pending={abilities.pending}
              placeholder="Write a reply…"
              submitLabel="Reply"
              workItemId={node.workItemId}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function displayName(comment: WorkItemCommentRow): string {
  return comment.authorName ?? comment.authorEmail ?? "Removed user";
}

function isAuthor(
  comment: WorkItemCommentRow,
  viewerMemberId: string | null,
): boolean {
  return viewerMemberId !== null && comment.authorMemberId === viewerMemberId;
}

/** One person's message: header, body (or edit form), reactions, actions. */
function CommentBody({
  comment,
  members,
  abilities,
  editing,
  compact,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReact,
  onReply,
}: {
  comment: WorkItemCommentRow;
  members: BacklogMemberRow[];
  abilities: Abilities;
  editing: boolean;
  /** Replies sit a size down, so a thread reads as one comment plus answers. */
  compact?: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  /** Absent on a reply — nesting stops at one level. */
  onReply?: () => void;
}) {
  const author = displayName(comment);
  // What the hover card starts from. authorMemberId is null for an AI comment
  // and for a person who has since left the org — both get the seed alone.
  const authorSeed = {
    memberId: comment.authorMemberId,
    name: author,
    email: comment.authorEmail,
    image: comment.authorImage,
  };
  // Controlled rather than wrapping the menu item as a trigger: a dialog
  // trigger nested inside a menu item fights the menu over the click and over
  // focus return, and this dialog must survive the menu closing under it.
  const [confirming, setConfirming] = useState(false);

  const isAi = comment.authorKind === "ai";
  // isAuthor is member-based, and an AI comment has no member — so nobody
  // edits the assistant's words, which is exactly right: an editable AI
  // comment could be rewritten into something a person never said and left
  // wearing the assistant's name.
  const canEdit = !isAi && isAuthor(comment, abilities.viewerMemberId);
  const canDelete = canEdit || abilities.canModerate;

  return (
    <div className="flex gap-2.5">
      {isAi ? (
        // A tinted glyph, not an avatar: an avatar shape is how this UI says
        // "a person", and the one thing this comment must never be mistaken
        // for is a person.
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground",
            compact ? "size-6" : "size-8",
          )}
        >
          <IconSparkles className={compact ? "size-3.5" : "size-4"} />
        </span>
      ) : (
        <UserGlimpse className="mt-0.5" interactive={false} seed={authorSeed}>
          <Avatar size={compact ? "sm" : "default"}>
            {comment.authorImage ? (
              <AvatarImage alt="" src={comment.authorImage} />
            ) : null}
            <AvatarFallback>{initialsOf(author)}</AvatarFallback>
          </Avatar>
        </UserGlimpse>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {isAi ? (
            <span
              className={cn(
                "font-semibold",
                compact ? "text-[13px]" : "text-sm",
              )}
            >
              {author}
            </span>
          ) : (
            <UserGlimpse
              className={cn(
                "font-semibold",
                compact ? "text-[13px]" : "text-sm",
              )}
              seed={authorSeed}
            >
              {author}
            </UserGlimpse>
          )}
          {isAi ? (
            <span
              className="rounded-[8px] bg-chip px-1.5 py-0.5 text-[11px] font-semibold text-foreground"
              title={
                comment.aiModel
                  ? `Generated by ${comment.aiModel}`
                  : "Generated by AI"
              }
            >
              AI
            </span>
          ) : null}
          <RelativeTime
            className="text-xs text-muted-foreground"
            date={comment.createdAt}
          />
          {comment.editedAt ? (
            <RelativeTime
              className="text-xs text-muted-foreground"
              date={comment.editedAt}
              titlePrefix="Edited"
            >
              · edited
            </RelativeTime>
          ) : null}

          {canEdit || canDelete ? (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label={`Actions for ${author}'s comment`}
                      className="size-7 text-muted-foreground"
                      size="icon"
                      variant="ghost"
                    >
                      <IconDotsVertical className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {canEdit ? (
                    <DropdownMenuItem onClick={onEdit}>
                      <IconPencil className="size-4" />
                      Edit
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <DropdownMenuItem
                      onClick={() => setConfirming(true)}
                      variant="destructive"
                    >
                      <IconTrash className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              <ConfirmDialog
                confirmLabel="Delete"
                description={
                  onReply
                    ? "This removes the comment and every reply under it, for everyone. The audit trail keeps the record."
                    : "This removes the reply for everyone. The audit trail keeps the record."
                }
                onConfirm={onDelete}
                onOpenChange={setConfirming}
                open={confirming}
                title="Delete this comment?"
                variant="destructive"
              />
            </div>
          ) : null}
        </div>

        {editing ? (
          <CommentComposer
            aiEnabled={abilities.aiEnabled}
            ariaLabel="Edit comment"
            attach={abilities.attach}
            initialBody={comment.body}
            // No workItemId, so the edit form gets the mention menu but no AI
            // toolbar: "draft a reply" makes no sense for text already posted,
            // and rewriting a published comment wholesale is what Delete is for.
            // Remounted per edit session, so the draft always starts from what
            // is stored right now rather than from the last abandoned edit.
            key={comment.editedAt?.toISOString() ?? comment.id}
            members={members}
            onCancel={onCancelEdit}
            onSubmit={onSaveEdit}
            pending={abilities.pending}
            submitLabel="Save"
          />
        ) : (
          <>
            {/* The HTML is produced on the server from stored markdown and
                passed through sanitize-html (src/lib/markdown.ts). The client
                never supplies HTML, so there is no path from a pasted tag to
                this sink. CommentBody only adds hover cards to the mention
                spans already in it — see its header. */}
            <CommentProse
              className={cn(
                compact ? "text-[13px]" : "text-sm",
                commentProseStyles,
              )}
              html={comment.bodyHtml}
              members={members}
            />

            <div className="flex flex-wrap items-center gap-2">
              <CommentReactionBar
                canReact={abilities.canComment}
                onToggle={onReact}
                pending={abilities.pending}
                reactions={comment.reactions}
              />
              {onReply && abilities.canComment ? (
                <Button
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={onReply}
                  size="sm"
                  variant="ghost"
                >
                  <IconCornerDownRight className="size-3.5" />
                  Reply
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The editor plus its two buttons — used for the reply box and the edit form.
 * The top-level composer stays inline in ItemComments because it also owns the
 * draft that survives a failed post.
 */
function CommentComposer({
  ariaLabel,
  initialBody = "",
  members,
  pending,
  placeholder,
  submitLabel,
  onCancel,
  onSubmit,
  aiEnabled,
  attach,
  workItemId,
  parentId,
}: {
  ariaLabel: string;
  initialBody?: string;
  members: BacklogMemberRow[];
  pending: boolean;
  placeholder?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (body: string) => void;
  aiEnabled?: boolean;
  /** Absent when the reader may not attach — see CommentEditor's own prop. */
  attach?: AttachmentUploader;
  /** Both required for the AI toolbar; absent on the edit form. */
  workItemId?: string;
  parentId?: string | null;
}) {
  const [body, setBody] = useState(initialBody);
  const editorRef = useRef<Editor | null>(null);

  function replace(markdown: string, mode: "replace" | "append" = "replace") {
    const next =
      mode === "append" && body.trim()
        ? `${body.trim()}\n\n${markdown}`
        : markdown;
    editorRef.current?.commands.setContent(next);
    setBody(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <CommentEditor
        aiEnabled={aiEnabled}
        ariaLabel={ariaLabel}
        attach={attach}
        editorRef={editorRef}
        members={members}
        onChange={setBody}
        placeholder={placeholder}
        toolbar={
          aiEnabled && workItemId ? (
            <CommentAiToolbar
              draft={body}
              onReplace={replace}
              parentId={parentId}
              workItemId={workItemId}
            />
          ) : null
        }
        value={initialBody}
      />
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel} size="sm" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={pending || !body.trim()}
          onClick={() => onSubmit(body)}
          size="sm"
        >
          {pending ? <Spinner className="size-4" /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Subscribes to the item's SSE stream and calls `onChange` whenever the thread
 * moves. EventSource reconnects on its own, so there is no retry loop here —
 * but a reconnect means events were missed, so `onopen` re-reads too.
 *
 * A tab that comes back to the foreground also re-reads: browsers throttle
 * background tabs hard enough that a stream can sit un-drained for minutes.
 */
function useCommentStream(workItemId: string, onChange: () => void) {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const source = new EventSource(
      `/api/work-items/${encodeURIComponent(workItemId)}/comments/stream`,
    );

    // Not `ready`: that fires on the FIRST open too, and the initial thread
    // came down with the page. Reconnects are what need reconciling.
    let opened = false;
    source.onopen = () => {
      if (opened) handler.current();
      opened = true;
    };
    source.addEventListener("comments", () => handler.current());

    const onVisible = () => {
      if (document.visibilityState === "visible") handler.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      source.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workItemId]);
}
