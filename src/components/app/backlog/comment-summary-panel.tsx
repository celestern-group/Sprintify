"use client";

import { IconSparkles, IconX } from "@tabler/icons-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { summarizeCommentThread } from "@/lib/actions/comment-ai";
import type { CommentSummary } from "@/lib/ai/comment-prompts";

/**
 * "Catch me up" — the thread summarised for someone who hasn't read it.
 *
 * The result is EPHEMERAL by design: it lives in this component's state and
 * nowhere else. A stored summary would go stale the moment anyone replied, and
 * a confidently-worded stale summary of a discussion is worse than no summary
 * — people would act on it without re-reading.
 *
 * Rendered as a distinct violet-marked panel rather than as a comment, because
 * it is not part of the conversation and must never be mistaken for one.
 */
export function CommentSummaryPanel({
  workItemId,
  disabled,
}: {
  workItemId: string;
  /** True when there's nothing worth summarising yet. */
  disabled?: boolean;
}) {
  const [summary, setSummary] = useState<CommentSummary | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const result = await summarizeCommentThread({ workItemId });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        setSummary(result.summary);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't summarise the thread.",
        );
      }
    });
  }

  if (!summary) {
    return (
      <Button
        className="h-8 gap-1.5 self-start px-2.5 text-brand"
        disabled={disabled || pending}
        onClick={run}
        size="sm"
        variant="ghost"
      >
        {pending ? (
          <Spinner className="size-4" />
        ) : (
          <IconSparkles className="size-4" />
        )}
        Catch me up
      </Button>
    );
  }

  return (
    <section
      aria-label="AI summary of the discussion"
      className="rounded-[11px] border border-border bg-secondary/40 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-[8px] bg-chip text-brand">
          <IconSparkles className="size-4" aria-hidden />
        </span>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          AI summary
        </h3>
        <div className="ml-auto flex items-center gap-1">
          <Button
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={run}
            size="sm"
            variant="ghost"
          >
            {pending ? <Spinner className="size-3.5" /> : null}
            Refresh
          </Button>
          <Button
            aria-label="Dismiss the summary"
            className="size-7"
            onClick={() => setSummary(null)}
            size="icon"
            variant="ghost"
          >
            <IconX className="size-4" />
          </Button>
        </div>
      </div>

      <p className="text-sm leading-relaxed">{summary.summary}</p>

      {summary.decisions.length > 0 ? (
        <SummaryList items={summary.decisions} title="Decided" />
      ) : null}
      {summary.openQuestions.length > 0 ? (
        <SummaryList items={summary.openQuestions} title="Still open" />
      ) : null}

      {/* Not a disclaimer for its own sake: this panel sits among comments
          people wrote, and the one thing a reader needs to know is that this
          one was generated and may be wrong. */}
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        Generated from the comments above — check anything you'd act on.
      </p>
    </section>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-2.5">
      <h4 className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {title}
      </h4>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => (
          <li className="flex gap-2 text-sm" key={item}>
            <span
              aria-hidden
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
