"use client";

import {
  IconArrowRight,
  IconChevronDown,
  IconChevronRight,
  IconCopyCheck,
  IconPlus,
  IconScaleOutline,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  type AiDraft,
  type SimilarItem,
  useAiCall,
} from "@/components/app/backlog/ai-item-tools";
import {
  LabelsTagPicker,
  MemberCombobox,
  PrioritySelect,
  SprintSelect,
  StatusSelect,
  TypeSelect,
} from "@/components/app/backlog/field-controls";
import { RichTextField } from "@/components/app/backlog/rich-text-field";
import type { FilterableRow } from "@/components/app/backlog/types";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import type { WorkItemPriority } from "@/db/schema/work-items";
import {
  draftWorkItem,
  findDuplicateWorkItems,
  suggestWorkItemEstimate,
} from "@/lib/actions/ai-assist";
import type {
  BacklogAiAbilities,
  BacklogMemberRow,
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemTypeRow,
} from "@/lib/actions/work-items";
import { createWorkItem } from "@/lib/actions/work-items";
import {
  fieldsForType,
  type WorkItemFieldDefinition,
} from "@/lib/work-item-fields";

/**
 * The backlog's inline composer: "New item" opens a form ON the backlog screen
 * instead of navigating to the create page.
 *
 * Why inline rather than a route or a dialog. Grooming is a run of items, not
 * one: the route costs a navigation and a load per item and drops you on the
 * new item's page afterwards, and a modal hides the very list you are adding to
 * — which is what you read to decide whether the next line is a duplicate, a
 * child, or already there. So the composer stays open after each create, keeps
 * the meta you picked (type, status, sprint, assignee), clears what belongs to
 * one item, and puts the caret back in the title box.
 *
 * It is a SUPERSET of the board's QuickAddCard (title + type in a column) and a
 * SUBSET of the item form: dates, business value, risk, parent and custom fields
 * live on the full form, which every footer here links to carrying the short
 * fields in the URL (the prose blocks are far too long for one, so the card
 * names them rather than losing them quietly). Two rules keep that split
 * honest:
 *
 *  - Prose blocks are the same `RichTextField` the item form uses, so markdown,
 *    mentions, pasted images and the field-level AI menu behave identically.
 *    They sit behind a disclosure because most rows never need them.
 *  - A type carrying REQUIRED custom fields can't be created from here (the
 *    server's `persistFieldValues` enforces them and this card has nowhere to
 *    put them), so the composer says which ones and hands over to the form —
 *    the same escape hatch quick-add takes.
 *
 * AI (all three gated on the org actually having the model slot, so no control
 * here can only answer "AI isn't configured"):
 *
 *  - "Draft it" turns the one line in the title box into a whole item —
 *    description, criteria, notes, type, priority, labels. Everything lands as
 *    an editable field, never as a save.
 *  - "Find similar" reads the project's own embeddings before you add the
 *    duplicate, which is the one moment the warning is still cheap.
 *  - "Suggest estimate" reads the median of comparable FINISHED items.
 */

/** Same cap the item form checks against `workItemDescriptionSchema`. */
const PROSE_LIMIT = 20_000;

type ProseKey = "description" | "acceptanceCriteria" | "technicalNotes";

const PROSE_LABELS: Record<ProseKey, string> = {
  description: "Description",
  acceptanceCriteria: "Acceptance criteria",
  technicalNotes: "Technical notes",
};

export function InlineItemComposer({
  projectId,
  basePath,
  types,
  statuses,
  sprints,
  members,
  fields,
  labelSuggestions,
  capacityUnit,
  ai,
  presets,
  fullFormHref,
  onCreated,
  onClose,
}: {
  projectId: string;
  /** /app/[orgSlug]/[projectKey] — similar-item links hang off it. */
  basePath: string;
  types: WorkItemTypeRow[];
  statuses: WorkflowStatusRow[];
  sprints: BacklogSprintRow[];
  members: BacklogMemberRow[];
  /** The org's custom field catalog — read only to spot required ones. */
  fields: WorkItemFieldDefinition[];
  labelSuggestions: string[];
  capacityUnit: "hours" | "points";
  ai: BacklogAiAbilities;
  /** What the screen already implies: the sprint or status being looked at. */
  presets?: { sprintId?: string | null; statusId?: string | null };
  /** `${basePath}/backlog/new`, already carrying the way back. */
  fullFormHref: string;
  /**
   * The row that just landed, as much of it as the filters read — the panel
   * re-reads the list AND checks whether its own filters are hiding what was
   * just created.
   */
  onCreated: (created: FilterableRow) => void;
  onClose: () => void;
}) {
  const defaultTypeId =
    types.find((type) => type.isDefault)?.id ?? types[0]?.id ?? "";
  const defaultStatusId =
    presets?.statusId ??
    statuses.find((status) => status.isDefault)?.id ??
    statuses[0]?.id ??
    "";

  const [typeId, setTypeId] = useState(defaultTypeId);
  const [statusId, setStatusId] = useState(defaultStatusId);
  const [sprintId, setSprintId] = useState(presets?.sprintId ?? "");
  const [assigneeMemberId, setAssigneeMemberId] = useState("");
  const [priority, setPriority] = useState<WorkItemPriority>("medium");
  const [points, setPoints] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [prose, setProse] = useState<Record<ProseKey, string>>({
    description: "",
    acceptanceCriteria: "",
    technicalNotes: "",
  });
  const [expanded, setExpanded] = useState(false);
  const [pending, startCreating] = useTransition();
  const summaryRef = useRef<HTMLInputElement>(null);

  /**
   * The prose editors own their document once mounted (see RichTextField), so
   * text arriving from anywhere but the keyboard — an AI draft, the reset after
   * a create — has to remount them. Bumping a revision is that remount.
   */
  const [revisions, setRevisions] = useState<Record<ProseKey, number>>({
    description: 0,
    acceptanceCriteria: 0,
    technicalNotes: 0,
  });

  function reseed(...keys: ProseKey[]) {
    setRevisions((current) => {
      const next = { ...current };
      for (const key of keys) next[key] += 1;
      return next;
    });
  }

  const { pending: aiPending, call } = useAiCall();
  const [similar, setSimilar] = useState<SimilarItem[] | null>(null);
  const [estimate, setEstimate] = useState<{
    points: number;
    basis: SimilarItem[];
  } | null>(null);

  const type = types.find((row) => row.id === typeId);
  const trimmed = summary.trim();
  const unitLabel = capacityUnit === "points" ? "Story points" : "Hours";
  const unitWord = capacityUnit === "points" ? "points" : "hours";
  // Required custom fields are enforced server-side and have no home here.
  const required = fieldsForType(fields, typeId).filter(
    (field) => field.isRequired,
  );
  const blocked = required.length > 0;

  /**
   * The full form, seeded with every SHORT field already picked in this card.
   * Seeds travel in the URL like every other create-page preset, which is what
   * bounds this: the prose blocks cap at 20,000 characters each and would blow
   * past what a browser (or a proxy's header limit) will carry, so they are
   * deliberately left behind — and the card says so rather than dropping them
   * quietly.
   */
  const handoff = (() => {
    const params = new URLSearchParams();
    if (typeId) params.set("type", typeId);
    if (statusId) params.set("status", statusId);
    if (sprintId) params.set("sprint", sprintId);
    if (assigneeMemberId) params.set("assignee", assigneeMemberId);
    if (priority !== "medium") params.set("priority", priority);
    if (points.trim()) params.set("points", points.trim());
    for (const label of labels) params.append("label", label);
    if (trimmed) params.set("summary", trimmed);
    const query = params.toString();
    // fullFormHref already carries `?from=`, so this appends rather than opens.
    return query
      ? `${fullFormHref}${fullFormHref.includes("?") ? "&" : "?"}${query}`
      : fullFormHref;
  })();

  /** What the handoff can't carry — named on screen while it still exists. */
  const unsentProse = (Object.keys(PROSE_LABELS) as ProseKey[]).filter(
    (key) => prose[key].trim().length > 0,
  );

  /**
   * A generated draft fills what is still empty and never overwrites what
   * someone already typed — the assistant is a head start, not an editor with
   * opinions about work in progress.
   */
  function applyDraft(draft: AiDraft) {
    setSummary((current) => current.trim() || draft.summary);
    setProse((current) => ({
      description: current.description.trim() || draft.description,
      acceptanceCriteria:
        current.acceptanceCriteria.trim() || draft.acceptanceCriteria,
      technicalNotes: current.technicalNotes.trim() || draft.technicalNotes,
    }));
    if (draft.typeId) setTypeId(draft.typeId);
    if (draft.priority) setPriority(draft.priority);
    setLabels((current) => (current.length > 0 ? current : draft.labels));
    reseed("description", "acceptanceCriteria", "technicalNotes");
    // What it wrote has to be visible to be editable — a draft folded away
    // behind a disclosure would save text nobody read.
    setExpanded(true);
  }

  function draft() {
    call(
      () => draftWorkItem({ projectId, request: trimmed }),
      (result) => {
        applyDraft(result.draft);
        toast.success("Drafted. Edit anything that isn't right.");
      },
    );
  }

  const searchText = [trimmed, prose.description].filter(Boolean).join("\n\n");

  function checkDuplicates() {
    call(
      () => findDuplicateWorkItems({ projectId, text: searchText }),
      (result) => {
        setSimilar(result.items);
        if (result.items.length === 0) toast.success("Nothing similar found.");
      },
    );
  }

  function suggestEstimate() {
    call(
      () => suggestWorkItemEstimate({ projectId, text: searchText }),
      (result) => {
        setEstimate(result.suggestion);
        if (!result.suggestion) {
          toast.info(
            `No comparable finished item carries an estimate yet, so there's nothing to read one off.`,
          );
        }
      },
    );
  }

  /** Clears what belongs to ONE item; keeps the meta the next one shares. */
  function resetForNext() {
    setSummary("");
    setProse({ description: "", acceptanceCriteria: "", technicalNotes: "" });
    setPoints("");
    setLabels([]);
    setSimilar(null);
    setEstimate(null);
    reseed("description", "acceptanceCriteria", "technicalNotes");
    summaryRef.current?.focus();
  }

  function submit() {
    if (!trimmed || !typeId || pending || blocked) return;

    // Markdown is longer than what's on screen, so this is checked here rather
    // than letting the server's zod cap come back as a parse error.
    const tooLong = (Object.keys(PROSE_LABELS) as ProseKey[]).filter(
      (key) => prose[key].length > PROSE_LIMIT,
    );
    if (tooLong.length > 0) {
      toast.error(
        `${tooLong.map((key) => PROSE_LABELS[key]).join(", ")} ${tooLong.length === 1 ? "is" : "are"} over the ${PROSE_LIMIT.toLocaleString()} character limit.`,
      );
      return;
    }

    const parsedPoints = points.trim() === "" ? null : Number(points);
    if (parsedPoints !== null && !Number.isFinite(parsedPoints)) {
      toast.error(`${unitLabel} must be a number.`);
      return;
    }

    startCreating(async () => {
      try {
        const created = await createWorkItem({
          projectId,
          typeId,
          statusId: statusId || undefined,
          summary: trimmed,
          description: prose.description || undefined,
          acceptanceCriteria: prose.acceptanceCriteria || undefined,
          technicalNotes: prose.technicalNotes || undefined,
          priority,
          points: parsedPoints,
          assigneeMemberId: assigneeMemberId || null,
          sprintId: sprintId || null,
          labels,
        });
        toast.success(`${created.key} created.`);
        resetForNext();
        // The row's key, number and rank are the server's to mint, so the list
        // re-reads rather than being patched optimistically — and the composer
        // stays open, which is the whole point of being inline.
        onCreated({
          id: created.id,
          key: created.key,
          summary: trimmed,
          labels,
          typeId,
          statusId,
          sprintId: sprintId || null,
          assigneeMemberId: assigneeMemberId || null,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't create that item.",
        );
      }
    });
  }

  const busy = pending || aiPending;

  /** Absent unless the org has a text model — see the AI note above. */
  const assist = ai.text
    ? { projectId, context: { summary: trimmed, typeName: type?.name } }
    : undefined;

  return (
    <section
      aria-label="New work item"
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-card"
      onKeyDown={(event) => {
        // ⌘/Ctrl+Enter from anywhere in the card — including inside a prose
        // editor, where a bare Enter is a new paragraph.
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-[11px] bg-secondary text-secondary-foreground">
          <IconPlus className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-sm">New item</h2>
          <p className="text-muted-foreground text-xs">
            It lands in this backlog — the card stays open for the next one.
          </p>
        </div>
        <Button
          aria-label="Close the composer"
          className="ml-auto shrink-0"
          disabled={pending}
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <IconX className="size-4" />
        </Button>
      </div>

      <Field>
        <FieldLabel className="sr-only" htmlFor="composer-summary">
          Name
        </FieldLabel>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            autoFocus
            className="min-w-40 flex-1 font-semibold"
            disabled={pending}
            id="composer-summary"
            maxLength={300}
            onChange={(event) => setSummary(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              // A bare Enter creates from the title box: on a grooming run the
              // title IS the item. The prose editors keep Enter for themselves.
              // ⌘/Ctrl+Enter is deliberately NOT handled here — it belongs to
              // the card's handler, and taking it in both places starts two
              // creates, since `pending` hasn't updated by the time it bubbles.
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="As a user, I can…"
            ref={summaryRef}
            value={summary}
          />
          {ai.text ? (
            <Button
              disabled={busy || trimmed.length < 3}
              onClick={draft}
              size="sm"
              title="Turn this line into a full item — description, criteria, type and priority"
              variant="outline"
            >
              {aiPending ? (
                <Spinner className="size-4" />
              ) : (
                <IconSparkles className="size-4" />
              )}
              Draft it
            </Button>
          ) : null}
        </div>
      </Field>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="composer-type">Type</FieldLabel>
          <TypeSelect
            disabled={pending}
            id="composer-type"
            onChange={setTypeId}
            types={types}
            value={typeId}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="composer-status">Status</FieldLabel>
          <StatusSelect
            disabled={pending}
            id="composer-status"
            onChange={setStatusId}
            statuses={statuses}
            value={statusId}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="composer-sprint">Sprint</FieldLabel>
          <SprintSelect
            disabled={pending}
            id="composer-sprint"
            onChange={setSprintId}
            sprints={sprints}
            value={sprintId}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="composer-assignee">Assignee</FieldLabel>
          <MemberCombobox
            disabled={pending}
            id="composer-assignee"
            members={members}
            onChange={setAssigneeMemberId}
            value={assigneeMemberId}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="composer-priority">Priority</FieldLabel>
          <PrioritySelect
            disabled={pending}
            id="composer-priority"
            onChange={setPriority}
            value={priority}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="composer-points">{unitLabel}</FieldLabel>
          <Input
            className="tabular-nums"
            disabled={pending}
            id="composer-points"
            min={0}
            onChange={(event) => setPoints(event.target.value)}
            placeholder="Unestimated"
            step="0.5"
            type="number"
            value={points}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="composer-labels">Labels</FieldLabel>
          <LabelsTagPicker
            disabled={pending}
            id="composer-labels"
            onChange={setLabels}
            suggestions={labelSuggestions}
            value={labels}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          size="sm"
          variant="ghost"
        >
          {expanded ? (
            <IconChevronDown className="size-4" />
          ) : (
            <IconChevronRight className="size-4" />
          )}
          {expanded ? "Hide detail" : "Add detail"}
        </Button>
        {ai.embedding ? (
          <>
            <Button
              disabled={busy || trimmed.length < 3}
              onClick={checkDuplicates}
              size="sm"
              title="Check this project for items that already mean the same thing"
              variant="outline"
            >
              <IconCopyCheck className="size-4" />
              Find similar
            </Button>
            <Button
              disabled={busy || trimmed.length < 3}
              onClick={suggestEstimate}
              size="sm"
              title={`Read an estimate off comparable finished items`}
              variant="outline"
            >
              <IconScaleOutline className="size-4" />
              Suggest estimate
            </Button>
          </>
        ) : null}
      </div>

      {expanded ? (
        <div className="flex min-w-0 flex-col gap-4">
          <RichTextField
            assist={assist}
            disabled={pending}
            id="composer-description"
            key={`composer-description-${revisions.description}`}
            label={PROSE_LABELS.description}
            members={members}
            minHeight="min-h-28"
            onChange={(markdown) =>
              setProse((current) => ({ ...current, description: markdown }))
            }
            placeholder="The context: what this is, who it's for, why now."
            value={prose.description}
          />
          <RichTextField
            assist={assist}
            disabled={pending}
            id="composer-acceptance"
            key={`composer-acceptance-${revisions.acceptanceCriteria}`}
            label={PROSE_LABELS.acceptanceCriteria}
            members={members}
            minHeight="min-h-24"
            onChange={(markdown) =>
              setProse((current) => ({
                ...current,
                acceptanceCriteria: markdown,
              }))
            }
            placeholder="Given …"
            value={prose.acceptanceCriteria}
          />
          <RichTextField
            assist={assist}
            disabled={pending}
            id="composer-technical"
            key={`composer-technical-${revisions.technicalNotes}`}
            label={PROSE_LABELS.technicalNotes}
            members={members}
            minHeight="min-h-24"
            onChange={(markdown) =>
              setProse((current) => ({ ...current, technicalNotes: markdown }))
            }
            placeholder="Approach, constraints, migrations, links to designs or docs."
            value={prose.technicalNotes}
          />
          <p className="text-muted-foreground text-xs">
            Dates, business value, risk, a parent and custom fields live on the{" "}
            <Link className="font-semibold text-brand" href={handoff}>
              full form
            </Link>
            .
          </p>
        </div>
      ) : null}

      {estimate ? (
        <div
          aria-live="polite"
          className="flex min-w-0 flex-col gap-2 rounded-[11px] border border-border p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold text-2xl tabular-nums">
              {estimate.points}
            </span>
            <span className="text-muted-foreground text-xs">
              {unitWord}, the median of {estimate.basis.length} comparable
              finished {estimate.basis.length === 1 ? "item" : "items"}
            </span>
            <Button
              className="ml-auto"
              onClick={() => {
                setPoints(String(estimate.points));
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
                  href={`${basePath}/backlog/${row.key}`}
                >
                  {row.key}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {row.summary} · {row.points} {unitWord}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {similar && similar.length > 0 ? (
        <div
          aria-live="polite"
          className="flex min-w-0 flex-col gap-2 rounded-[11px] border border-border bg-warning-tint p-3"
        >
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
                  href={`${basePath}/backlog/${row.key}`}
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

      {blocked ? (
        // Named, not silent: the create would fail on the server with the same
        // field names, one round trip later.
        <p className="text-warning text-xs">
          {required.map((field) => field.label).join(", ")}{" "}
          {required.length === 1 ? "is" : "are"} required on{" "}
          {type?.name ?? "this type"} — finish it on the full form.
        </p>
      ) : null}

      {unsentProse.length > 0 && (expanded || blocked) ? (
        // The handoff carries the short fields in the URL and nothing else, so
        // the prose that WON'T survive it is named while it's still on screen.
        <p className="text-warning text-xs">
          {unsentProse.map((key) => PROSE_LABELS[key]).join(", ")} stay in this
          card — the full form starts them empty. Copy{" "}
          {unsentProse.length === 1 ? "it" : "them"} across, or create the item
          from here.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <p className="hidden text-muted-foreground text-xs sm:block">
          Enter to create · Escape to close
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button disabled={pending} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          {blocked ? (
            <Button nativeButton={false} render={<Link href={handoff} />}>
              Full form
              <IconArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button disabled={pending || trimmed.length === 0} onClick={submit}>
              {pending ? <Spinner className="size-4" /> : null}
              Create item
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
