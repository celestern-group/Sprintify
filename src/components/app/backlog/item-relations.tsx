"use client";

import {
  IconArrowRight,
  IconLink,
  IconLinkOff,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ParentCombobox } from "@/components/app/backlog/field-controls";
import type { ParentCandidate } from "@/components/app/backlog/item-form";
import {
  StatusCategoryIcon,
  WorkItemTypeIcon,
} from "@/components/app/backlog/work-item-visuals";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { useReturnToHref } from "@/hooks/use-return-to";
import {
  createWorkItem,
  linkWorkItems,
  setWorkItemParent,
  unlinkWorkItems,
  type WorkflowStatusRow,
  type WorkItemTypeRow,
} from "@/lib/actions/work-items";
import { RETURN_TO_PARAM, withReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";
import {
  fieldsForType,
  type WorkItemFieldDefinition,
} from "@/lib/work-item-fields";
import { canParent, WORKFLOW_CATEGORY_CLASSES } from "@/lib/work-items";

/** One end of a link — a parent above, or a child below. */
export type RelatedItem = {
  id: string;
  key: string;
  summary: string;
  typeId: string;
  statusId: string;
  /**
   * The child's own estimate. Shown on child rows because this panel is where
   * a parent's rolled-up total is checked against what it is made of — an
   * unestimated child here is the reason the total looks low.
   */
  points?: number | null;
};

/**
 * The item's place in the tree: what it hangs under, what hangs under it, and
 * the controls to change either.
 *
 * It renders INSIDE the form's sidebar "Relations" section, in place of that
 * section's Parent picker — one control per fact, so the parent can't be moved
 * from two places that disagree about whether the change autosaves. The
 * sidebar is a ~20rem column, so every row is two tight lines (key + marks,
 * then the summary) rather than the one wide line a full-width card affords.
 *
 * The panel renders even when both sides are empty. An epic with no stories is
 * exactly the item whose owner needs the "Add child" button, and hiding the
 * section until a link exists means the first link can never be made from here.
 *
 * Every write goes through `setWorkItemParent`, in both directions: linking a
 * parent sends this item, linking a child sends the CHILD. The child's own
 * project is what gets permission-checked, which is the point — being able to
 * edit an epic must not confer the right to re-file someone else's story.
 */
export function ItemRelations({
  itemId,
  itemTypeId,
  parent,
  childItems,
  relatedItems,
  candidates,
  types,
  statuses,
  fields,
  basePath,
  projectId,
  abilities,
}: {
  itemId: string;
  itemTypeId: string;
  parent: RelatedItem | null;
  childItems: RelatedItem[];
  relatedItems: RelatedItem[];
  /** Every item in the project — filtered here by level, as the server does. */
  candidates: ParentCandidate[];
  types: WorkItemTypeRow[];
  statuses: WorkflowStatusRow[];
  /** The org's custom field catalog, read only to spot required ones. */
  fields: WorkItemFieldDefinition[];
  projectId: string;
  basePath: string;
  abilities: { create: boolean; update: boolean };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [composer, setComposer] = useState<
    "none" | "parent" | "child" | "new" | "related"
  >("none");

  const level =
    types.find((row) => row.id === itemTypeId)?.hierarchyLevel ?? null;
  const statusById = new Map(statuses.map((row) => [row.id, row]));
  const typeById = new Map(types.map((row) => [row.id, row]));

  const levelOf = (typeId: string) =>
    typeById.get(typeId)?.hierarchyLevel ?? null;

  // The same rules the server enforces (assertParentAllowed): same project, the
  // level rule kept by whichever item is the CHILD in the pairing, never itself.
  // A type with `strictHierarchy` off waives it entirely. Cycles deeper than one
  // hop are the server's call — the picker can't see the whole tree, so it
  // offers and lets the action refuse.
  const strictOf = (typeId: string) =>
    typeById.get(typeId)?.strictHierarchy ?? true;
  // This item is the child, so its own type decides.
  const strict = strictOf(itemTypeId);

  const parentCandidates = candidates.filter((row) => {
    const candidateLevel = levelOf(row.typeId);
    return (
      row.id !== itemId &&
      level !== null &&
      candidateLevel !== null &&
      canParent(candidateLevel, level, strict)
    );
  });
  // Here the CANDIDATE is the child, so the rule is read off its type.
  const childCandidates = candidates.filter((row) => {
    const candidateLevel = levelOf(row.typeId);
    return (
      row.id !== itemId &&
      row.parentId !== itemId &&
      level !== null &&
      candidateLevel !== null &&
      canParent(level, candidateLevel, strictOf(row.typeId))
    );
  });
  const childTypes = types.filter(
    (row) =>
      level !== null &&
      canParent(level, row.hierarchyLevel, row.strictHierarchy),
  );
  const relatedIds = new Set(relatedItems.map((row) => row.id));
  const relatedCandidates = candidates.filter(
    (row) => row.id !== itemId && !relatedIds.has(row.id),
  );

  function relink(
    workItemId: string,
    parentId: string | null,
    message: string,
  ) {
    startTransition(async () => {
      try {
        await setWorkItemParent({ workItemId, parentId });
        setComposer("none");
        toast.success(message);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't change that link.",
        );
      }
    });
  }

  function toggle(next: "parent" | "child" | "new" | "related") {
    setComposer((current) => (current === next ? "none" : next));
  }

  function relate(relatedWorkItemId: string, message: string) {
    startTransition(async () => {
      try {
        await linkWorkItems({ workItemId: itemId, relatedWorkItemId });
        setComposer("none");
        toast.success(message);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't link that item.",
        );
      }
    });
  }

  function unrelate(relatedWorkItemId: string, message: string) {
    startTransition(async () => {
      try {
        await unlinkWorkItems({ workItemId: itemId, relatedWorkItemId });
        toast.success(message);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't remove that link.",
        );
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <RowHeading
          label="Parent"
          action={
            abilities.update && parentCandidates.length > 0 ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => toggle("parent")}
              >
                <IconLink className="size-3.5" aria-hidden />
                {parent ? "Change" : "Link"}
              </Button>
            ) : null
          }
        />

        {parent ? (
          <RelationRow
            row={parent}
            type={typeById.get(parent.typeId)}
            status={statusById.get(parent.statusId)}
            basePath={basePath}
            action={
              abilities.update ? (
                <IconButton
                  label={`Detach ${parent.key} as parent`}
                  disabled={pending}
                  onClick={() =>
                    relink(itemId, null, `Detached from ${parent.key}.`)
                  }
                >
                  <IconX className="size-3.5" aria-hidden />
                </IconButton>
              ) : null
            }
          />
        ) : (
          <Blank>
            {parentCandidates.length === 0
              ? "Nothing in this project sits above this type."
              : "Not filed under anything."}
          </Blank>
        )}

        {composer === "parent" ? (
          <LinkPicker
            id="link-parent"
            label="File this item under"
            candidates={parentCandidates}
            types={types}
            pending={pending}
            note="Moves this item under the one you pick."
            onCancel={() => setComposer("none")}
            onLink={(chosen) => {
              const target = parentCandidates.find((row) => row.id === chosen);
              relink(itemId, chosen, `Filed under ${target?.key ?? "parent"}.`);
            }}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-t border-border pt-3">
        <RowHeading
          label={
            childItems.length === 0
              ? "Child items"
              : `Child items · ${childItems.length}`
          }
          action={
            childTypes.length > 0 ? (
              <span className="flex items-center gap-1">
                {abilities.update && childCandidates.length > 0 ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => toggle("child")}
                  >
                    <IconLink className="size-3.5" aria-hidden />
                    Link
                  </Button>
                ) : null}
                {abilities.create ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => toggle("new")}
                  >
                    <IconPlus className="size-3.5" aria-hidden />
                    Add
                  </Button>
                ) : null}
              </span>
            ) : null
          }
        />

        {childItems.length === 0 ? (
          <Blank>
            {childTypes.length === 0
              ? "This type sits at the bottom — nothing can hang under it."
              : "Nothing broken out under this item."}
          </Blank>
        ) : (
          <ul className="flex min-w-0 flex-col gap-0.5">
            {childItems.map((child) => (
              <li className="min-w-0" key={child.id}>
                <RelationRow
                  row={child}
                  type={typeById.get(child.typeId)}
                  status={statusById.get(child.statusId)}
                  basePath={basePath}
                  action={
                    abilities.update ? (
                      <IconButton
                        label={`Unlink ${child.key} from this item`}
                        disabled={pending}
                        onClick={() =>
                          relink(child.id, null, `${child.key} unlinked.`)
                        }
                      >
                        <IconLinkOff className="size-3.5" aria-hidden />
                      </IconButton>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {composer === "child" ? (
          <LinkPicker
            id="link-child"
            label="Bring an item under this one"
            candidates={childCandidates}
            types={types}
            pending={pending}
            note="An item that already has a parent is MOVED here, not copied."
            onCancel={() => setComposer("none")}
            onLink={(chosen) => {
              const target = childCandidates.find((row) => row.id === chosen);
              relink(chosen, itemId, `${target?.key ?? "Item"} linked.`);
            }}
          />
        ) : null}

        {composer === "new" ? (
          <ChildComposer
            projectId={projectId}
            parentId={itemId}
            types={childTypes}
            fields={fields}
            basePath={basePath}
            onDone={() => {
              setComposer("none");
              router.refresh();
            }}
            onCancel={() => setComposer("none")}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-t border-border pt-3">
        <RowHeading
          label={
            relatedItems.length === 0
              ? "Related items"
              : `Related items · ${relatedItems.length}`
          }
          action={
            abilities.update && relatedCandidates.length > 0 ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => toggle("related")}
              >
                <IconLink className="size-3.5" aria-hidden />
                Link
              </Button>
            ) : null
          }
        />

        {relatedItems.length === 0 ? (
          <Blank>
            Link items that are related without changing their hierarchy.
          </Blank>
        ) : (
          <ul className="flex min-w-0 flex-col gap-0.5">
            {relatedItems.map((related) => (
              <li className="min-w-0" key={related.id}>
                <RelationRow
                  row={related}
                  type={typeById.get(related.typeId)}
                  status={statusById.get(related.statusId)}
                  basePath={basePath}
                  action={
                    abilities.update ? (
                      <IconButton
                        label={`Remove link to ${related.key}`}
                        disabled={pending}
                        onClick={() =>
                          unrelate(
                            related.id,
                            `Removed link to ${related.key}.`,
                          )
                        }
                      >
                        <IconLinkOff className="size-3.5" aria-hidden />
                      </IconButton>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {composer === "related" ? (
          <LinkPicker
            id="link-related"
            label="Link a related item"
            candidates={relatedCandidates}
            types={types}
            pending={pending}
            note="Keeps both items where they are in the hierarchy."
            onCancel={() => setComposer("none")}
            onLink={(chosen) => {
              const target = relatedCandidates.find((row) => row.id === chosen);
              relate(chosen, `${target?.key ?? "Item"} linked as related.`);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The inline "Add child" composer: a title and a type, nothing else — the same
 * bargain the board's quick-add strikes, for the same reason (everything else
 * `createWorkItemSchema` accepts is optional, and a planning session produces
 * five sub-tasks in a row, not one).
 *
 * When the chosen type carries a required custom field this steps aside and
 * hands off to the full form with the title, type and parent already set,
 * rather than letting `persistFieldValues` refuse the create a round trip later.
 */
function ChildComposer({
  projectId,
  parentId,
  types,
  fields,
  basePath,
  onDone,
  onCancel,
}: {
  projectId: string;
  parentId: string;
  types: WorkItemTypeRow[];
  fields: WorkItemFieldDefinition[];
  basePath: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [typeId, setTypeId] = useState(
    types.find((row) => row.isDefault)?.id ?? types[0]?.id ?? "",
  );
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLInputElement>(null);
  const returnTo = useReturnToHref();

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const trimmed = summary.trim();
  const required = fieldsForType(fields, typeId).filter(
    (field) => field.isRequired,
  );
  const blocked = required.length > 0;

  const handoff = (() => {
    const params = new URLSearchParams({ parent: parentId });
    if (typeId) params.set("type", typeId);
    if (trimmed) params.set("summary", trimmed);
    // The parent item is where this composer lives, so it is where cancelling
    // out of the full form belongs.
    params.set(RETURN_TO_PARAM, returnTo);
    return `${basePath}/backlog/new?${params.toString()}`;
  })();

  function submit() {
    if (!trimmed || !typeId || pending || blocked) return;
    startTransition(async () => {
      try {
        const created = await createWorkItem({
          projectId,
          typeId,
          summary: trimmed,
          parentId,
        });
        toast.success(`${created.key} created.`);
        setSummary("");
        onDone();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't create that item.",
        );
      }
    });
  }

  return (
    <Composer>
      <label className="sr-only" htmlFor="new-child-summary">
        Title of the new child item
      </label>
      <Input
        id="new-child-summary"
        ref={boxRef}
        value={summary}
        maxLength={300}
        disabled={pending}
        placeholder="What needs doing?"
        onChange={(event) => setSummary(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />

      <NativeSelect
        size="sm"
        value={typeId}
        disabled={pending}
        aria-label="Type of the new child item"
        onChange={(event) => setTypeId(event.target.value)}
      >
        {types.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </NativeSelect>

      {blocked ? (
        <p className="text-[11px] text-warning">
          {required.map((field) => field.label).join(", ")}{" "}
          {required.length === 1 ? "is" : "are"} required on this type — finish
          it on the full form.
        </p>
      ) : null}

      <ComposerActions onCancel={onCancel} pending={pending}>
        {blocked ? (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={handoff} />}
          >
            Full form
            <IconArrowRight className="size-3.5" aria-hidden />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={submit}
            disabled={pending || trimmed.length === 0}
          >
            {pending ? <Spinner className="size-3.5" /> : null}
            Add
          </Button>
        )}
      </ComposerActions>
    </Composer>
  );
}

/** Pick an existing item and link it — one combobox, one confirming button. */
function LinkPicker({
  id,
  label,
  candidates,
  types,
  pending,
  note,
  onLink,
  onCancel,
}: {
  id: string;
  label: string;
  candidates: ParentCandidate[];
  types: WorkItemTypeRow[];
  pending: boolean;
  note: string;
  onLink: (id: string) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState("");

  return (
    <Composer>
      <label
        className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      <ParentCombobox
        id={id}
        value={chosen}
        onChange={setChosen}
        candidates={candidates}
        types={types}
        disabled={pending}
        allowNone={false}
        placeholder="Search for an item…"
      />
      <p className="text-[11px] text-muted-foreground">{note}</p>
      <ComposerActions onCancel={onCancel} pending={pending}>
        <Button
          size="sm"
          onClick={() => onLink(chosen)}
          disabled={pending || chosen === ""}
        >
          {pending ? <Spinner className="size-3.5" /> : null}
          Link
        </Button>
      </ComposerActions>
    </Composer>
  );
}

function Composer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[11px] border border-border bg-muted/40 p-2.5">
      {children}
    </div>
  );
}

function ComposerActions({
  pending,
  onCancel,
  children,
}: {
  pending: boolean;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      {children}
    </div>
  );
}

/**
 * One linked item, two lines: the key and its marks, then the summary. A single
 * line would truncate the summary to nothing in a 20rem column — and the
 * summary is the only part that says what the link IS.
 *
 * The status rides as its category glyph rather than a full chip: the shape
 * differs per category and the name is in the `title`/sr-only text, so colour
 * is still never the only signal, but the row keeps its width for the summary.
 */
function RelationRow({
  row,
  type,
  status,
  basePath,
  action,
}: {
  row: RelatedItem;
  type: WorkItemTypeRow | undefined;
  status: WorkflowStatusRow | undefined;
  basePath: string;
  action: React.ReactNode;
}) {
  // Walking the tree keeps a way back to the item you walked it from — a
  // parent's back link would otherwise be the backlog, three levels up.
  const returnTo = useReturnToHref();

  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[11px] px-2 py-1.5 transition-colors hover:bg-muted">
      <div className="flex min-w-0 items-center gap-1.5">
        {type ? <WorkItemTypeIcon type={type} /> : null}
        <Link
          href={withReturnTo(`${basePath}/backlog/${row.key}`, returnTo)}
          className="min-w-0 shrink-0 text-sm font-semibold tabular-nums text-brand hover:underline"
        >
          {row.key}
        </Link>
        {status ? (
          <span
            className="flex min-w-0 items-center gap-1"
            title={`Status: ${status.name}`}
          >
            <StatusCategoryIcon
              category={status.category}
              className={cn(
                "size-3.5 shrink-0",
                WORKFLOW_CATEGORY_CLASSES[status.category],
              )}
            />
            <span className="truncate text-[11px] text-muted-foreground">
              {status.name}
            </span>
          </span>
        ) : null}
        <span className="flex-1" />
        {row.points !== null && row.points !== undefined ? (
          <span
            title="Estimate"
            className="shrink-0 rounded-sm bg-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
          >
            {row.points}
          </span>
        ) : null}
        {action}
      </div>
      <p className="min-w-0 truncate pl-6.5 text-xs text-muted-foreground">
        {row.summary}
      </p>
    </div>
  );
}

/** An uppercase sub-label with its own controls parked on the right. */
function RowHeading({
  label,
  action,
}: {
  label: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>
      {action}
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="px-2 text-xs text-muted-foreground">{children}</p>;
}

/** A destructive-adjacent affordance that has to survive a dense row. */
function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 text-muted-foreground hover:text-destructive"
    >
      {children}
    </Button>
  );
}
