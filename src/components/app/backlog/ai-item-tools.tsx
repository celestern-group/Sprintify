"use client";

import {
  IconAlertTriangle,
  IconBinaryTree,
  IconChecklist,
  IconCopyCheck,
  IconScaleOutline,
  IconSparkles,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { WorkItemPriority } from "@/db/schema/work-items";
import { useReturnToHref } from "@/hooks/use-return-to";
import {
  createChildWorkItems,
  deriveAcceptanceCriteria,
  deriveDefectFields,
  draftWorkItem,
  findDuplicateWorkItems,
  suggestChildWorkItems,
  suggestWorkItemEstimate,
} from "@/lib/actions/ai-assist";
import { withReturnTo } from "@/lib/return-to";

/**
 * The item-level AI tools — everything that reads or writes MORE than the one
 * field you are standing in.
 *
 * Structured mirror of the field menu's rule: nothing lands in the form without
 * being shown first. Suggestions arrive as previews, lists and checkboxes; the
 * only action that writes to the database on its own is creating the child
 * items the author ticked.
 */

/** Locally declared: the server modules that own these shapes are server-only. */
export type SimilarItem = {
  id: string;
  key: string;
  summary: string;
  statusCategory: "todo" | "in_progress" | "done";
  points: number | null;
  similarity: number;
};

type ChildSuggestion = {
  summary: string;
  description: string;
  acceptanceCriteria: string;
  points?: number | null;
};

/** A suggestion once it's on screen: given an id to key on, and a keep flag. */
type ChildDraft = ChildSuggestion & { uid: string; keep: boolean };

export type AiDraft = {
  summary: string;
  description: string;
  acceptanceCriteria: string;
  technicalNotes: string;
  labels: string[];
  typeId: string | null;
  priority: WorkItemPriority | null;
};

/**
 * Every AI action answers `{ ok: false, message }` for the expected failures —
 * no provider configured, a model that returned nonsense — and throws for the
 * rest. One helper so no call site has to remember which is which.
 */
export function useAiCall() {
  const [pending, startTransition] = useTransition();

  function call<R extends { ok: boolean }>(
    work: () => Promise<R>,
    onDone: (result: Extract<R, { ok: true }>) => void,
  ) {
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          toast.error((result as unknown as { message: string }).message);
          return;
        }
        onDone(result as Extract<R, { ok: true }>);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "That didn't work.",
        );
      }
    });
  }

  return { pending, call };
}

/**
 * Create-page only: one sentence in, a filled form out. The form stays the
 * author's — every generated value is a starting point they then edit.
 */
export function AiDraftCard({
  projectId,
  onDraft,
}: {
  projectId: string;
  onDraft: (draft: AiDraft) => void;
}) {
  const [request, setRequest] = useState("");
  const { pending, call } = useAiCall();

  function generate() {
    call(
      () => draftWorkItem({ projectId, request: request.trim() }),
      (result) => {
        onDraft(result.draft);
        toast.success("Draft filled in. Edit anything that isn't right.");
      },
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-[11px] bg-secondary text-secondary-foreground">
          <IconSparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-sm">Start from a sentence</h2>
          <p className="text-muted-foreground text-xs">
            Describe the work; the fields below get filled in for you to edit.
          </p>
        </div>
      </div>
      <Field>
        <FieldLabel className="sr-only" htmlFor="ai-draft-request">
          What needs building?
        </FieldLabel>
        <Textarea
          id="ai-draft-request"
          maxLength={2000}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Customers on the free plan should see how much of their quota is left."
          rows={2}
          value={request}
        />
      </Field>
      <div className="flex justify-end">
        <Button
          disabled={pending || request.trim().length < 3}
          onClick={generate}
          variant="outline"
        >
          {pending ? <Spinner className="size-4" /> : <IconSparkles />}
          Draft item
        </Button>
      </div>
    </section>
  );
}

export function AiItemTools({
  projectId,
  workItemId,
  basePath,
  summary,
  description,
  acceptanceCriteria,
  tracksDefect,
  capacityUnit,
  canCreateChildren,
  onAcceptanceCriteria,
  onDefectFields,
  onPoints,
}: {
  projectId: string;
  /** Null on the create page — the item doesn't exist yet. */
  workItemId?: string | null;
  basePath: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  tracksDefect: boolean;
  capacityUnit: "hours" | "points";
  canCreateChildren: boolean;
  onAcceptanceCriteria: (markdown: string) => void;
  onDefectFields: (fields: {
    stepsToReproduce: string;
    expectedResult: string;
    actualResult: string;
  }) => void;
  onPoints: (points: number) => void;
}) {
  const router = useRouter();
  const { pending, call } = useAiCall();
  const [similar, setSimilar] = useState<SimilarItem[] | null>(null);
  const [estimate, setEstimate] = useState<{
    points: number;
    basis: SimilarItem[];
  } | null>(null);
  const [children, setChildren] = useState<{
    items: ChildDraft[];
    childType: { id: string; name: string };
  } | null>(null);
  const [creating, startCreating] = useTransition();
  // A duplicate or an estimate basis is a side trip: the reader is mid-edit on
  // THIS item and needs it back, not the backlog.
  const returnTo = useReturnToHref();

  const hasSummary = summary.trim().length > 0;
  const hasDescription = description.trim().length > 0;
  const searchText = [summary, description].filter(Boolean).join("\n\n");
  const unit = capacityUnit === "points" ? "points" : "hours";

  function generateCriteria() {
    call(
      () =>
        deriveAcceptanceCriteria({
          projectId,
          workItemId,
          summary: summary.trim(),
          description: description.trim(),
          existing: acceptanceCriteria.trim() || null,
        }),
      (result) => {
        onAcceptanceCriteria(result.acceptanceCriteria);
        toast.success("Acceptance criteria written into the field.");
      },
    );
  }

  function splitDefect() {
    call(
      () =>
        deriveDefectFields({
          projectId,
          workItemId,
          summary: summary.trim(),
          report: description.trim(),
        }),
      (result) => {
        onDefectFields(result);
        toast.success("Report split into steps, expected and actual.");
      },
    );
  }

  function checkDuplicates() {
    call(
      () =>
        findDuplicateWorkItems({
          projectId,
          text: searchText,
          excludeWorkItemId: workItemId,
        }),
      (result) => {
        setSimilar(result.items);
        if (result.items.length === 0) toast.success("Nothing similar found.");
      },
    );
  }

  function suggestEstimate() {
    call(
      () =>
        suggestWorkItemEstimate({
          projectId,
          workItemId,
          text: searchText,
        }),
      (result) => {
        setEstimate(result.suggestion);
        if (!result.suggestion) {
          toast.info(
            "No comparable finished item carries an estimate yet, so there's nothing to read one off.",
          );
        }
      },
    );
  }

  function breakDown() {
    if (!workItemId) return;
    call(
      () => suggestChildWorkItems({ workItemId }),
      (result) => {
        if (result.items.length === 0) {
          toast.info("Nothing left to break out of this item.");
          return;
        }
        setChildren({
          childType: result.childType,
          items: result.items.map((item) => ({
            ...item,
            uid: crypto.randomUUID(),
            keep: true,
          })),
        });
      },
    );
  }

  function createChildren() {
    if (!children || !workItemId) return;
    const chosen = children.items.filter((item) => item.keep);
    if (chosen.length === 0) return;

    startCreating(async () => {
      try {
        const { created } = await createChildWorkItems({
          parentId: workItemId,
          typeId: children.childType.id,
          items: chosen.map((item) => ({
            summary: item.summary,
            description: item.description || undefined,
            acceptanceCriteria: item.acceptanceCriteria || undefined,
            points: item.points ?? null,
          })),
        });
        setChildren(null);
        toast.success(
          `Created ${created.length} ${children.childType.name.toLowerCase()}${created.length === 1 ? "" : "s"}.`,
        );
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't create those items.",
        );
      }
    });
  }

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-[11px] bg-secondary text-secondary-foreground">
          <IconSparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-sm">Assistant</h2>
          <p className="text-muted-foreground text-xs">
            Suggestions only — nothing here saves the item for you.
          </p>
        </div>
        {pending ? <Spinner className="ml-auto size-4" /> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || !hasSummary || !hasDescription}
          onClick={generateCriteria}
          size="sm"
          variant="outline"
        >
          <IconChecklist />
          {acceptanceCriteria.trim() ? "Refine criteria" : "Write criteria"}
        </Button>
        {tracksDefect ? (
          <Button
            disabled={pending || !hasSummary || !hasDescription}
            onClick={splitDefect}
            size="sm"
            variant="outline"
          >
            <IconAlertTriangle />
            Split the report
          </Button>
        ) : null}
        <Button
          disabled={pending || !hasSummary}
          onClick={checkDuplicates}
          size="sm"
          variant="outline"
        >
          <IconCopyCheck />
          Find similar
        </Button>
        <Button
          disabled={pending || !hasSummary}
          onClick={suggestEstimate}
          size="sm"
          variant="outline"
        >
          <IconScaleOutline />
          Suggest estimate
        </Button>
        {workItemId && canCreateChildren ? (
          <Button
            disabled={pending}
            onClick={breakDown}
            size="sm"
            variant="outline"
          >
            <IconBinaryTree />
            Break into items
          </Button>
        ) : null}
      </div>

      {!hasDescription ? (
        <p className="text-muted-foreground text-xs">
          Criteria and the report split read the description — write that first.
        </p>
      ) : null}

      {estimate ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-[11px] border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold text-2xl tabular-nums">
              {estimate.points}
            </span>
            <span className="text-muted-foreground text-xs">
              {unit}, the median of {estimate.basis.length} comparable finished{" "}
              {estimate.basis.length === 1 ? "item" : "items"}
            </span>
            <Button
              className="ml-auto"
              onClick={() => {
                onPoints(estimate.points);
                setEstimate(null);
                toast.success("Estimate applied.");
              }}
              size="sm"
            >
              Use it
            </Button>
          </div>
          <ul className="flex flex-col gap-1">
            {estimate.basis.map((row) => (
              <li className="min-w-0 text-xs" key={row.id}>
                <Link
                  className="text-brand underline underline-offset-2"
                  href={withReturnTo(
                    `${basePath}/backlog/${row.key}`,
                    returnTo,
                  )}
                >
                  {row.key}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {row.summary} · {row.points} {unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {similar && similar.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-[11px] border border-border bg-warning-tint p-3">
          <p className="font-semibold text-sm">
            {similar.length} similar {similar.length === 1 ? "item" : "items"}{" "}
            already in this project
          </p>
          <ul className="flex flex-col gap-1.5">
            {similar.map((row) => (
              <li
                className="flex min-w-0 items-center gap-2 text-sm"
                key={row.id}
              >
                <Link
                  className="shrink-0 text-brand underline underline-offset-2"
                  href={withReturnTo(
                    `${basePath}/backlog/${row.key}`,
                    returnTo,
                  )}
                >
                  {row.key}
                </Link>
                <span className="min-w-0 truncate">{row.summary}</span>
                <Badge
                  className="ml-auto shrink-0 tabular-nums"
                  variant="secondary"
                >
                  {Math.round(row.similarity * 100)}%
                </Badge>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button onClick={() => setSimilar(null)} size="sm" variant="ghost">
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        onOpenChange={(open) => !open && setChildren(null)}
        open={!!children}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Break into {children?.childType.name.toLowerCase()} items
            </DialogTitle>
            <DialogDescription>
              Untick anything you don't want. Each one is created under this
              item, in the backlog, unassigned.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[50vh] min-w-0 flex-col gap-2 overflow-y-auto">
            {children?.items.map((item) => (
              <div
                className="flex min-w-0 items-start gap-3 rounded-[11px] border border-border p-3"
                key={item.uid}
              >
                <Checkbox
                  aria-label={`Create "${item.summary}"`}
                  checked={item.keep}
                  className="mt-0.5"
                  id={`ai-child-${item.uid}`}
                  onCheckedChange={(checked) =>
                    setChildren((current) =>
                      current
                        ? {
                            ...current,
                            items: current.items.map((row) =>
                              row.uid === item.uid
                                ? { ...row, keep: checked === true }
                                : row,
                            ),
                          }
                        : current,
                    )
                  }
                />
                <label
                  className="flex min-w-0 cursor-pointer flex-col gap-1"
                  htmlFor={`ai-child-${item.uid}`}
                >
                  <span className="font-medium text-sm">{item.summary}</span>
                  {item.description ? (
                    <span className="line-clamp-3 text-muted-foreground text-xs">
                      {item.description}
                    </span>
                  ) : null}
                  {item.points != null ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {item.points} {unit}
                    </span>
                  ) : null}
                </label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setChildren(null)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={creating || !children?.items.some((item) => item.keep)}
              onClick={createChildren}
            >
              {creating ? <Spinner className="size-4" /> : null}
              Create {children?.items.filter((item) => item.keep).length ?? 0}{" "}
              items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FieldDescription>
        Similar items and estimates are read from this project's own history.
      </FieldDescription>
    </section>
  );
}
