"use client";

import { IconMoodPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CommentReactionSummary } from "@/lib/actions/work-item-comments";
import { COMMENT_REACTIONS, reactionLabel } from "@/lib/comment-reactions";
import { cn } from "@/lib/utils";

/**
 * The reaction row under a comment: one chip per emoji people have used, plus
 * an add control.
 *
 * Design-system shape — a chip is a NEUTRAL surface carrying a small mark and
 * a tabular count, never a coloured fill. "I reacted" is expressed as filled
 * selection (`--tint` + tint-ink), the same language active nav and selected
 * rows use, rather than an outline: an edge at this size is invisible.
 *
 * Every chip carries the reaction's WORD in its accessible name ("Agree, 3")
 * because a glyph alone is not a label — the same rule that keeps status from
 * being colour-only.
 */
export function CommentReactionBar({
  reactions,
  canReact,
  pending,
  onToggle,
}: {
  reactions: CommentReactionSummary[];
  canReact: boolean;
  pending: boolean;
  onToggle: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!canReact && reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <button
          className={cn(
            "flex h-7 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            reaction.reacted
              ? "border-transparent bg-secondary font-semibold text-secondary-foreground"
              : "border-border bg-chip text-foreground hover:bg-muted",
            !canReact && "cursor-default",
          )}
          disabled={!canReact || pending}
          key={reaction.emoji}
          // The tooltip names people; the aria-label names the reaction and
          // the count, because a screen reader gets no value from a list of
          // names it has to hold in memory.
          aria-label={`${reactionLabel(reaction.emoji)}, ${reaction.count}${
            reaction.reacted ? ", including you" : ""
          }`}
          onClick={() => onToggle(reaction.emoji)}
          title={`${reactionLabel(reaction.emoji)} · ${describeWho(reaction)}`}
          type="button"
        >
          <span aria-hidden>{reaction.emoji}</span>
          <span aria-hidden className="tabular-nums">
            {reaction.count}
          </span>
        </button>
      ))}

      {canReact ? (
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger
            render={
              <Button
                aria-label="Add a reaction"
                className="size-7 rounded-full text-muted-foreground"
                disabled={pending}
                size="icon"
                variant="ghost"
              >
                <IconMoodPlus className="size-4" />
              </Button>
            }
          />
          <PopoverContent align="start" className="w-auto p-1.5">
            <div className="flex gap-0.5">
              {COMMENT_REACTIONS.map((entry) => (
                <button
                  aria-label={entry.label}
                  className="grid size-8 place-items-center rounded-[8px] text-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  key={entry.emoji}
                  onClick={() => {
                    setOpen(false);
                    onToggle(entry.emoji);
                  }}
                  title={entry.label}
                  type="button"
                >
                  <span aria-hidden>{entry.emoji}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

/** "Ada, Grace and 3 others" — the names are capped server-side. */
function describeWho(reaction: CommentReactionSummary): string {
  const shown = reaction.names;
  const hidden = reaction.count - shown.length;
  const names =
    shown.length <= 1
      ? (shown[0] ?? `${reaction.count} people`)
      : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return hidden > 0 ? `${names} and ${hidden} others` : names;
}
