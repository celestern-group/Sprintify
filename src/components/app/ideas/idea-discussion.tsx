"use client";

import { IconCornerDownRight, IconMessage } from "@tabler/icons-react";
import type { Editor } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  CommentEditor,
  commentProseStyles,
} from "@/components/app/backlog/comment-editor";
import { CommentProse } from "@/components/app/backlog/comment-prose";
import { CommentReactionBar } from "@/components/app/backlog/comment-reaction-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  addIdeaComment,
  type IdeaCommentNode,
  toggleIdeaCommentReaction,
} from "@/lib/actions/ideas";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import { mentionedMemberIdsIn } from "@/lib/mentions";
import { initialsOf } from "@/lib/work-items";

type Member = { id: string; name: string; email: string };

export function IdeaDiscussion({
  ideaId,
  projectId,
  comments,
  members,
  canComment,
}: {
  ideaId: string;
  projectId: string;
  comments: IdeaCommentNode[];
  members: Member[];
  canComment: boolean;
}) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editorRef = useRef<Editor | null>(null);
  const [draft, setDraft] = useState("");
  const router = useRouter();
  const mentionMembers: BacklogMemberRow[] = members.map((member) => ({
    memberId: member.id,
    name: member.name,
    email: member.email,
    image: null,
  }));

  function post(body: string, parentId: string | null, done: () => void) {
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await addIdeaComment({
          projectId,
          ideaId,
          body,
          parentId,
          mentionedMemberIds: mentionedMemberIdsIn(body),
        });
        done();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't post comment.",
        );
      }
    });
  }

  function toggleReaction(commentId: string, emoji: string) {
    startTransition(async () => {
      try {
        await toggleIdeaCommentReaction({ commentId, emoji });
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't update reaction.",
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discussion</CardTitle>
        <CardDescription>
          Capture assumptions, questions, and team context before committing
          work.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {comments.length ? (
          <ol className="divide-y divide-border">
            {comments.map((comment) => (
              <IdeaComment
                canComment={canComment}
                comment={comment}
                key={comment.id}
                members={mentionMembers}
                onReply={setReplyingTo}
                onReact={toggleReaction}
                onSubmitReply={(body, parentId) =>
                  post(body, parentId, () => setReplyingTo(null))
                }
                pending={pending}
                replyingTo={replyingTo}
              />
            ))}
          </ol>
        ) : (
          <p className="rounded-[11px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {canComment
              ? "No comments yet. Start the discussion — type @ to bring someone in."
              : "No comments yet."}
          </p>
        )}
        {canComment ? (
          <div className="grid gap-2 rounded-[11px] border border-border bg-card p-3 shadow-card">
            <CommentEditor
              ariaLabel="Write a comment"
              editorRef={editorRef}
              members={mentionMembers}
              onChange={setDraft}
              placeholder="Write a comment… type @ to mention someone"
              value=""
            />
            <div className="flex justify-end">
              <Button
                disabled={pending || !draft.trim()}
                onClick={() =>
                  post(draft, null, () => {
                    setDraft("");
                    editorRef.current?.commands.clearContent();
                  })
                }
              >
                {pending ? <Spinner className="size-4" /> : <IconMessage />}
                Comment
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IdeaComment({
  comment,
  members,
  canComment,
  replyingTo,
  pending,
  onReply,
  onReact,
  onSubmitReply,
  depth = 0,
}: {
  comment: IdeaCommentNode;
  members: BacklogMemberRow[];
  canComment: boolean;
  replyingTo: string | null;
  pending: boolean;
  onReply: (id: string | null) => void;
  onReact: (commentId: string, emoji: string) => void;
  onSubmitReply: (body: string, parentId: string) => void;
  /** Hierarchy is shown by a continuous rail, not a stack of cards. */
  depth?: number;
}) {
  const replying = replyingTo === comment.id;
  return (
    <li className={depth === 0 ? "py-4 first:pt-0 last:pb-0" : "py-2"}>
      <CommentBody
        comment={comment}
        members={members}
        onReply={() => onReply(comment.id)}
        onReact={(emoji) => onReact(comment.id, emoji)}
        canComment={canComment}
        pending={pending}
      />
      {comment.replies.length || replying ? (
        <div className="mt-2 grid gap-2 border-l-2 border-border pl-3 sm:pl-4">
          {comment.replies.length ? (
            <ol className="divide-y divide-border/70">
              {comment.replies.map((reply) => (
                <IdeaComment
                  canComment={canComment}
                  comment={reply}
                  key={reply.id}
                  members={members}
                  onReply={onReply}
                  onReact={onReact}
                  onSubmitReply={onSubmitReply}
                  pending={pending}
                  replyingTo={replyingTo}
                  depth={depth + 1}
                />
              ))}
            </ol>
          ) : null}
          {replying ? (
            <ReplyComposer
              members={members}
              onCancel={() => onReply(null)}
              onSubmit={(body) => onSubmitReply(body, comment.id)}
              pending={pending}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function CommentBody({
  comment,
  members,
  canComment,
  pending,
  onReply,
  onReact,
}: {
  comment: IdeaCommentNode;
  members: BacklogMemberRow[];
  canComment: boolean;
  pending: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
}) {
  const author = comment.name ?? comment.email ?? "Former member";
  return (
    <div className="flex gap-2.5">
      <Avatar>
        <AvatarFallback>{initialsOf(author)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{author}</span>
          <RelativeTime
            className="text-xs text-muted-foreground"
            date={comment.createdAt}
          />
        </div>
        <CommentProse
          className={`mt-1.5 text-sm ${commentProseStyles}`}
          html={comment.bodyHtml}
          members={members}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <CommentReactionBar
            canReact={canComment}
            onToggle={onReact}
            pending={pending}
            reactions={comment.reactions}
          />
          {canComment ? (
            <Button onClick={onReply} size="sm" variant="ghost">
              <IconCornerDownRight />
              Reply
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReplyComposer({
  members,
  pending,
  onCancel,
  onSubmit,
}: {
  members: BacklogMemberRow[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  return (
    <div className="grid gap-2">
      <CommentEditor
        ariaLabel="Write a reply"
        members={members}
        onChange={setBody}
        placeholder="Write a reply… type @ to mention someone"
        value=""
      />
      <div className="flex justify-end gap-2">
        <Button disabled={pending} onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={pending || !body.trim()}
          onClick={() => onSubmit(body)}
          size="sm"
        >
          {pending ? <Spinner className="size-4" /> : null}Reply
        </Button>
      </div>
    </div>
  );
}
