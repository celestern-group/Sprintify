"use client";

import { type DragEndEvent, useDroppable } from "@dnd-kit/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { StatusChip } from "@/components/app/backlog/work-item-visuals";
import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import {
  ListGroup,
  ListItem,
  ListItems,
  ListProvider,
} from "@/components/kibo-ui/list";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  WORKFLOW_STATUS_CATEGORIES,
  WORKFLOW_STATUS_CATEGORY_LABELS,
  type WorkflowStatusCategory,
} from "@/db/schema/work-items";
import type { ManagedWorkflowStatus } from "@/lib/actions/workflow-statuses";
import {
  createWorkflowStatus,
  deleteWorkflowStatus,
  reorderWorkflowStatuses,
  updateWorkflowStatus,
} from "@/lib/actions/workflow-statuses";
import { cn } from "@/lib/utils";

type Draft = {
  name: string;
  description: string;
  category: WorkflowStatusCategory;
  wipLimit: string;
  isDefault: boolean;
};

const EMPTY: Draft = {
  name: "",
  description: "",
  category: "todo",
  wipLimit: "",
  isDefault: false,
};

const GROUP_ID = "workflow-statuses";
const ROW_PREFIX = "row:";

/**
 * The project's flow — these rows are the board's columns, in this order.
 *
 * Reordering is drag (Kibo UI's List, same primitives as the backlog) AND
 * up/down buttons. The buttons are not redundant: dnd-kit's pointer drag is
 * mouse/touch-only in practice, and this surface has to stay fully keyboard
 * operable.
 *
 * Kibo's List registers only GROUPS as droppables, which is useless for a
 * single-group reorder, so each row wraps itself in its own droppable
 * (`row:<id>`) — the same composition the backlog list view uses.
 */
export function WorkflowPanel({
  project,
  basePath,
  statuses,
  canManage,
}: {
  project: { id: string; key: string; name: string };
  basePath: string;
  statuses: ManagedWorkflowStatus[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedWorkflowStatus | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();
  // Optimistic order: a drag or an up/down click rewrites the list at once,
  // and the server round-trip takes over again the moment `statuses` comes
  // back as a new array (which is exactly what a refresh produces) — so the
  // snapshot carries the array it was taken from rather than needing an
  // effect to clear it.
  const [snapshot, setSnapshot] = useState<{
    source: ManagedWorkflowStatus[];
    order: ManagedWorkflowStatus[];
  } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const rows = snapshot?.source === statuses ? snapshot.order : statuses;
  const activeStatus = rows.find((status) => status.id === activeId) ?? null;

  function run(work: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  }

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY);
    setOpen(true);
  }

  function openEdit(status: ManagedWorkflowStatus) {
    setEditing(status);
    setDraft({
      name: status.name,
      description: status.description ?? "",
      category: status.category,
      wipLimit: status.wipLimit === null ? "" : String(status.wipLimit),
      isDefault: status.isDefault,
    });
    setOpen(true);
  }

  function save() {
    const wipLimit = draft.wipLimit === "" ? null : Number(draft.wipLimit);
    run(
      async () => {
        if (editing) {
          await updateWorkflowStatus({
            statusId: editing.id,
            projectId: project.id,
            name: draft.name,
            description: draft.description || undefined,
            category: draft.category,
            wipLimit,
            isDefault: draft.isDefault,
          });
        } else {
          await createWorkflowStatus({
            projectId: project.id,
            name: draft.name,
            description: draft.description || undefined,
            category: draft.category,
            wipLimit,
          });
        }
        setOpen(false);
      },
      editing ? "Status saved." : "Status added.",
    );
  }

  function commitOrder(next: ManagedWorkflowStatus[]) {
    setSnapshot({ source: statuses, order: next });
    run(
      () =>
        reorderWorkflowStatuses({
          projectId: project.id,
          statusIds: next.map((status) => status.id),
        }),
      "Column order saved.",
    );
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...rows];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commitOrder(next);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!canManage) return;
    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    const overStatusId = overId.startsWith(ROW_PREFIX)
      ? overId.slice(ROW_PREFIX.length)
      : null;

    const from = rows.findIndex((status) => status.id === active.id);
    if (from < 0) return;

    const rest = rows.filter((status) => status.id !== active.id);
    // Dropping on the group rather than a row means "put it last".
    const overIndex = overStatusId
      ? rest.findIndex((status) => status.id === overStatusId)
      : rest.length;
    const to = overIndex < 0 ? rest.length : overIndex;
    if (to === from) return;

    rest.splice(to, 0, rows[from]);
    commitOrder(rest);
  }

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow={project.key}
        title="Workflow"
        description="The columns this project's board runs on, left to right."
        backHref={`${basePath}/backlog`}
        backLabel="Back to backlog"
      >
        {canManage ? (
          <Button onClick={openCreate}>
            <IconPlus className="size-4" />
            New status
          </Button>
        ) : null}
      </PageHeader>

      <SectionCard
        title="Columns"
        description="Drag a row (or use the arrows) to reorder the board left to right. Category is what the code reads — 'done' is what stamps an item as complete and feeds sprint arithmetic. The name is yours."
      >
        {statuses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-semibold">No statuses yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              This board has no columns — every work item needs a status to land
              in.
              {canManage
                ? " Use “New status” above to add the first one."
                : " Ask a project admin to add one."}
            </p>
            {canManage ? (
              <Button onClick={openCreate}>
                <IconPlus className="size-4" />
                New status
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="hidden items-center gap-3 border-b border-border px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground sm:flex">
              {canManage ? <span className="w-5 shrink-0" /> : null}
              <span className="min-w-0 flex-1">Status</span>
              <span className="w-28 shrink-0">Category</span>
              <span className="w-20 shrink-0 text-right">WIP limit</span>
              <span className="w-16 shrink-0 text-right">Items</span>
              {canManage ? <span className="w-40 shrink-0" /> : null}
            </div>

            <ListProvider
              onDragEnd={handleDragEnd}
              onDragStart={(event) => setActiveId(String(event.active.id))}
              onDragCancel={() => setActiveId(null)}
              overlay={
                activeStatus ? (
                  <div className="flex cursor-grabbing items-center gap-3 rounded-md border border-border bg-card px-2 py-2.5 shadow-float">
                    <IconGripVertical className="size-4 shrink-0 text-muted-foreground" />
                    <StatusRowCells status={activeStatus} />
                  </div>
                ) : null
              }
            >
              <ListGroup id={GROUP_ID} className="bg-transparent">
                <ListItems className="gap-0 p-0">
                  {rows.map((status, index) => (
                    <StatusRow key={status.id} id={status.id}>
                      <ListItem
                        id={status.id}
                        name={status.name}
                        index={index}
                        parent={GROUP_ID}
                        className={cn(
                          "gap-3 rounded-md px-2 py-2.5",
                          !canManage && "cursor-default",
                        )}
                      >
                        {canManage ? (
                          <IconGripVertical
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        ) : null}
                        <StatusRowCells status={status} />
                        {canManage ? (
                          <span className="flex w-40 shrink-0 items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending || index === 0}
                              aria-label={`Move ${status.name} earlier`}
                              onClick={() => move(index, -1)}
                            >
                              <IconArrowUp className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending || index === rows.length - 1}
                              aria-label={`Move ${status.name} later`}
                              onClick={() => move(index, 1)}
                            >
                              <IconArrowDown className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${status.name}`}
                              onClick={() => openEdit(status)}
                            >
                              <IconPencil className="size-4" />
                            </Button>
                            <ConfirmDialog
                              title={`Delete ${status.name}?`}
                              description="Only an empty column can be deleted — move its items first."
                              confirmLabel="Delete"
                              variant="destructive"
                              onConfirm={() =>
                                run(
                                  () =>
                                    deleteWorkflowStatus({
                                      statusId: status.id,
                                    }),
                                  "Status deleted.",
                                )
                              }
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete ${status.name}`}
                                >
                                  <IconTrash className="size-4" />
                                </Button>
                              }
                            />
                          </span>
                        ) : null}
                      </ListItem>
                    </StatusRow>
                  ))}
                </ListItems>
              </ListGroup>
            </ListProvider>
          </div>
        )}
      </SectionCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? editing.name : "New status"}</DialogTitle>
            <DialogDescription>
              A status belongs to one of three categories. Everything the code
              decides — completion, burn-down, board grouping — reads the
              category, never the name.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="status-name">Name</FieldLabel>
              <Input
                id="status-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="status-description">Description</FieldLabel>
              <Textarea
                id="status-description"
                rows={2}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="status-category">Category</FieldLabel>
                <NativeSelect
                  id="status-category"
                  className="w-full"
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      category: event.target.value as WorkflowStatusCategory,
                    })
                  }
                >
                  {WORKFLOW_STATUS_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {WORKFLOW_STATUS_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="status-wip">WIP limit</FieldLabel>
                <Input
                  id="status-wip"
                  type="number"
                  min={1}
                  className="tabular-nums"
                  value={draft.wipLimit}
                  placeholder="No limit"
                  onChange={(event) =>
                    setDraft({ ...draft, wipLimit: event.target.value })
                  }
                />
              </Field>
            </div>
            {editing ? (
              <Field orientation="horizontal">
                <Switch
                  id="status-default"
                  checked={draft.isDefault}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, isDefault: checked })
                  }
                />
                <FieldLabel htmlFor="status-default">
                  New items land in this column
                </FieldLabel>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !draft.name.trim()} onClick={save}>
              {pending ? <Spinner className="size-4" /> : null}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

/**
 * One row's own drop target — Kibo's List only makes the group droppable, so
 * without this a drop could not say *where* in the list the row belongs.
 */
function StatusRow({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${ROW_PREFIX}${id}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-b border-border transition-colors last:border-b-0",
        isOver && "bg-accent",
      )}
    >
      {children}
    </div>
  );
}

function StatusRowCells({ status }: { status: ManagedWorkflowStatus }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{status.name}</span>
          {status.isDefault ? (
            <Badge variant="default">New items land here</Badge>
          ) : null}
        </span>
        {status.description ? (
          <span className="max-w-lg truncate text-xs text-muted-foreground">
            {status.description}
          </span>
        ) : null}
        {/* The two numeric columns fold into the name block on mobile. */}
        <span className="text-xs tabular-nums text-muted-foreground sm:hidden">
          WIP {status.wipLimit ?? "—"} · {status.itemCount} items
        </span>
      </span>
      <span className="w-28 shrink-0">
        <StatusChip
          name={WORKFLOW_STATUS_CATEGORY_LABELS[status.category]}
          category={status.category}
        />
      </span>
      <span className="hidden w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
        {status.wipLimit ?? "—"}
      </span>
      <span className="hidden w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
        {status.itemCount}
      </span>
    </>
  );
}
