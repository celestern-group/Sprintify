"use client";

import {
  IconCalendar,
  IconChevronDown,
  IconRocket,
  IconStack2,
} from "@tabler/icons-react";
import { useState } from "react";
import {
  describeEstimate,
  useEstimates,
} from "@/components/app/backlog/estimate-context";
import { ItemRowIcons } from "@/components/app/backlog/item-card";
import {
  type BacklogMenuContext,
  ItemMenu,
} from "@/components/app/backlog/item-context-menu";
import { SelectBox } from "@/components/app/backlog/selection";
import type { BacklogGrouping } from "@/components/app/backlog/types";
import { StatusChip } from "@/components/app/backlog/work-item-visuals";
import { SprintStateBadge } from "@/components/app/sprint-state-badge";
import { UserGlimpse } from "@/components/app/user-glimpse";
import { Pill } from "@/components/kibo-ui/pill";
import {
  type ColumnDef,
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHead,
  TableHeader,
  TableHeaderGroup,
  TableProvider,
  TableRow,
} from "@/components/kibo-ui/table";
import { WORK_ITEM_PRIORITY_LABELS } from "@/db/schema/work-items";
import {
  reviveNumberRecord,
  usePersistedState,
} from "@/hooks/use-persisted-state";
import type {
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemRow,
  WorkItemTypeRow,
} from "@/lib/actions/work-items";
import { formatIsoShort } from "@/lib/date-only";
import { effectiveEstimates } from "@/lib/estimate-rollup";
import { cn } from "@/lib/utils";
import { buildTreeRows } from "@/lib/work-item-tree";
import { PRIORITY_WEIGHT } from "@/lib/work-items";

/** One indent step, in px — the same ladder the ranked list uses. */
const INDENT = 18;

/** buildTreeRows takes it; the table has no roll-up chip to feed. */
const NO_ROLLUPS = new Map();

/** Column titles, kept here so the resize handle can name what it resizes. */
const COLUMN_LABELS: Record<string, string> = {
  number: "Item",
  summary: "Summary",
  status: "Status",
  priority: "Priority",
  points: "Estimate",
  actualEfforts: "Actual",
  dueDate: "Due",
  assignee: "Assignee",
  sprint: "Sprint",
};

/**
 * Starting widths for the FIXED columns, in px. Summary is deliberately absent
 * — see below.
 *
 * The table is `table-fixed` rather than auto-layout so that a column keeps the
 * same width whatever happens to land in it — grouped, the view renders one
 * table per sprint, and auto-layout would size each of them to its own content,
 * leaving eight columns that step sideways from card to card.
 *
 * These are only the defaults: every fixed column carries a drag handle, and
 * the widths the user drags live in ONE state above all the group tables so the
 * cards keep sharing a grid. Grouped, the sprint column is dropped (the card
 * header already says it) and its share goes to the summary.
 */
/** Stable "nothing dragged yet" identity for the persisted widths. */
const NO_COLUMN_SIZING: Record<string, number> = {};

const COLUMN_SIZES: Record<BacklogGrouping, Record<string, number>> = {
  none: {
    number: 168,
    status: 132,
    priority: 96,
    points: 84,
    actualEfforts: 84,
    dueDate: 112,
    assignee: 152,
    sprint: 132,
  },
  sprint: {
    number: 168,
    status: 132,
    priority: 96,
    points: 84,
    actualEfforts: 84,
    dueDate: 112,
    assignee: 152,
  },
};

/**
 * Summary is the FLEXIBLE column: it carries no width, so it absorbs whatever
 * the canvas has left over.
 *
 * Something has to. Every column being a fixed px width leaves the slack to the
 * table, and `table-fixed` hands slack out in PROPORTION to the widths — which
 * means a 100px drag lands as 60px and drags the seven other columns sideways
 * with it. A trailing spacer column absorbs it just as well but parks hundreds
 * of dead pixels on the right of a wide screen. The prose column taking the
 * slack is the one that reads better the more room it gets, and it makes every
 * other drag land exactly where the pointer let go.
 */
const FLEX_COLUMN = "summary";

/** Below this the summary stops shrinking and the table scrolls instead. */
const SUMMARY_MIN = 220;

/** No column may be dragged narrower than this. */
const MIN_COLUMN = 56;

/**
 * The dense scanning view, on Kibo UI's Table primitives (TanStack Table
 * underneath) — every field in its own sortable column.
 *
 * Sorting is by the value the column MEANS, not by its label: priority sorts by
 * weight, status by its position in the project's flow. Sorting "In review"
 * next to "In progress" alphabetically would be worse than not sorting at all.
 *
 * `grouping` is the toolbar's, shared with the list and the timeline. Grouped,
 * this becomes one table per sprint in its own card rather than group header
 * rows inside a single table — a header row only survives while the rows happen
 * to be adjacent, so the first sort by any other column would scatter the same
 * sprint across a dozen repeated headers. Separate tables sort WITHIN their
 * group, which is what "sort this sprint by due date" should mean, and the
 * sorting state is shared, so every card sorts the same way at once.
 *
 * `nested` is the Hierarchy switch, also shared: rows come out in tree order,
 * children indented under their parent and a chevron on every row that has any,
 * so a big epic folds away the same way it does in the list. It turns column
 * sorting OFF, because the two orderings are the same axis — a table sorted by
 * due date has already decided where every row goes, and there is nowhere left
 * to put a child. The headers stop offering a sort rather than offering one
 * that would silently flatten the tree.
 */
export function TableView({
  items,
  statuses,
  sprints,
  types,
  menu,
  grouping,
  nested,
  onOpen,
}: {
  items: WorkItemRow[];
  statuses: WorkflowStatusRow[];
  sprints: BacklogSprintRow[];
  types: WorkItemTypeRow[];
  /** The right-click menu's catalogs, rights and shared selection. */
  menu: BacklogMenuContext;
  /** One table, or one table per sprint. */
  grouping: BacklogGrouping;
  /** Children indented under their parent, in tree order. */
  nested: boolean;
  onOpen: (item: WorkItemRow) => void;
}) {
  const grouped = grouping === "sprint";
  // Parent-from-children estimates, computed once for the panel (see
  // EstimateProvider) so the Estimate column agrees with the list and board.
  const estimates = useEstimates() ?? effectiveEstimates(items);
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const sprintById = new Map(sprints.map((sprint) => [sprint.id, sprint]));

  // Folded parents. Not persisted — a reading posture, not a preference, same
  // as the list view's. Kept even while `nested` is off so toggling Hierarchy
  // back on restores what was folded rather than re-expanding the whole tree.
  const [foldedIds, setFoldedIds] = useState<ReadonlySet<string>>(new Set());
  // Dragged column widths, shared by every group table (see COLUMN_SIZES).
  // Persisted, unlike the folds above: a width is a layout you set once and
  // expect to find again, and re-dragging five columns on every visit is the
  // kind of chore that makes the table view not worth using.
  const [columnSizing, setColumnSizing] = usePersistedState<
    Record<string, number>
  >("table.columnSizing", NO_COLUMN_SIZING, reviveNumberRecord);

  function toggleFold(itemId: string) {
    setFoldedIds((current) => {
      const next = new Set(current);
      if (!next.delete(itemId)) next.add(itemId);
      return next;
    });
  }

  /**
   * Tree order plus, per row, its depth and whether it folds. `ghostParents` is
   * off: the list view can draw a parent from another sprint as an inert
   * context row, but a table row is a record — a row that isn't in this table's
   * data would be a lie in every other column. Those children render at top
   * level instead.
   */
  function treeOf(rows: WorkItemRow[]) {
    if (!nested) return { rows, tree: null };
    const tree = buildTreeRows({
      items: rows,
      allItems: items,
      rollups: NO_ROLLUPS,
      collapsed: foldedIds,
      ghostParents: false,
    });
    return {
      rows: tree.map((row) => row.item),
      tree: new Map(tree.map((row) => [row.item.id, row])),
    };
  }

  function columnsFor(
    tree: Map<
      string,
      { depth: number; hasChildren: boolean; collapsed: boolean }
    > | null,
    /** This table's rows in draw order — what a shift-range spans. */
    orderedIds: string[],
  ): ColumnDef<WorkItemRow>[] {
    // Nested, every first-column cell reserves the chevron's width whether or
    // not this row has one, so the keys stay in one column.
    const foldable = tree !== null;
    const base: ColumnDef<WorkItemRow>[] = [
      {
        accessorKey: "number",
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Item" />
        ),
        cell: ({ row }) => {
          const node = tree?.get(row.original.id);
          return (
            // The indent rides on the first column, so the whole record steps
            // in together rather than the summary sliding away from its own
            // key.
            <span
              className="flex items-center gap-1"
              style={{ paddingLeft: (node?.depth ?? 0) * INDENT }}
            >
              {/* The tick box rides in the key column rather than a column of
                  its own: a ninth column would cost every table a fixed 40px
                  of width for something that is empty most of the time. */}
              <SelectBox
                item={row.original}
                selection={menu.selection}
                orderedIds={orderedIds}
                className="mr-0.5"
              />
              {node?.hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleFold(row.original.id)}
                  aria-expanded={!node.collapsed}
                  aria-label={`${node.collapsed ? "Show" : "Hide"} children of ${row.original.key}`}
                  className="-my-1 shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <IconChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 transition-transform",
                      node.collapsed && "-rotate-90",
                    )}
                  />
                </button>
              ) : foldable ? (
                <span aria-hidden className="size-5 shrink-0" />
              ) : null}
              <ItemRowIcons item={row.original} types={types} />
            </span>
          );
        },
      },
      {
        accessorKey: "summary",
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Summary" />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onOpen(row.original)}
            aria-label={`Open ${row.original.key}`}
            className="block w-full cursor-pointer truncate text-left font-medium hover:underline"
          >
            {row.original.summary}
          </button>
        ),
      },
      {
        id: "status",
        accessorFn: (item) => statusById.get(item.statusId)?.position ?? 0,
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const status = statusById.get(row.original.statusId);
          return status ? (
            <StatusChip name={status.name} category={status.category} />
          ) : null;
        },
      },
      {
        id: "priority",
        accessorFn: (item) => PRIORITY_WEIGHT[item.priority],
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Priority" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {WORK_ITEM_PRIORITY_LABELS[row.original.priority]}
          </span>
        ),
      },
      {
        id: "points",
        // Sorts on the EFFECTIVE estimate, so an epic sorts by what it is
        // carrying rather than sinking to the bottom for having no number of
        // its own. Unestimated sorts below zero rather than above everything:
        // "no estimate" is not the largest estimate.
        accessorFn: (item) => estimates.get(item.id)?.value ?? -1,
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Estimate" />
        ),
        cell: ({ row }) => {
          const estimate = estimates.get(row.original.id);
          if (!estimate || estimate.value === null)
            return <span className="tabular-nums">—</span>;
          return (
            <span
              title={describeEstimate(estimate, "")}
              className={cn(
                "tabular-nums",
                estimate.source === "rollup" && "text-muted-foreground",
              )}
            >
              {estimate.value}
            </span>
          );
        },
      },
      {
        id: "actualEfforts",
        // Never rolled up: actuals are what somebody typed against THIS row, so
        // a parent showing the sum of its children would invent time nobody
        // recorded. Unrecorded sorts below zero, same rule as the estimate.
        accessorFn: (item) => item.actualEfforts ?? -1,
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Actual" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.actualEfforts ?? "—"}
          </span>
        ),
      },
      {
        id: "dueDate",
        accessorFn: (item) => item.dueDate ?? "9999-12-31",
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Due" />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {row.original.dueDate ? formatIsoShort(row.original.dueDate) : "—"}
          </span>
        ),
      },
      {
        id: "assignee",
        accessorFn: (item) => item.assigneeName ?? "",
        header: ({ column }) => (
          <TableColumnHeader column={column} title="Assignee" />
        ),
        cell: ({ row }) =>
          row.original.assigneeName ? (
            <UserGlimpse
              className="whitespace-nowrap text-foreground"
              interactive={false}
              seed={{
                memberId: row.original.assigneeMemberId,
                name: row.original.assigneeName,
                image: row.original.assigneeImage,
              }}
            >
              {row.original.assigneeName}
            </UserGlimpse>
          ) : (
            <span className="whitespace-nowrap text-muted-foreground">
              Unassigned
            </span>
          ),
      },
      // Grouped, the card header already names the sprint — a column repeating it
      // down every row would be the same word eight times.
      ...(grouped
        ? []
        : [
            {
              id: "sprint",
              accessorFn: (item: WorkItemRow) =>
                item.sprintId
                  ? (sprintById.get(item.sprintId)?.name ?? "")
                  : "",
              header: ({ column }) => (
                <TableColumnHeader column={column} title="Sprint" />
              ),
              cell: ({ row }) => (
                <span className="whitespace-nowrap text-muted-foreground">
                  {row.original.sprintId
                    ? (sprintById.get(row.original.sprintId)?.name ?? "—")
                    : "Backlog"}
                </span>
              ),
            } satisfies ColumnDef<WorkItemRow>,
          ]),
    ];

    // Nested, every header renders as plain text: `TableColumnHeader` drops
    // its sort menu when the column can't sort, so the affordance disappears
    // with the capability instead of lingering as a dead control.
    return base.map((column) => {
      // `accessorKey` columns carry no explicit id; theirs is the key — and
      // there are two of them (`number` and `summary`), so it has to be read
      // rather than assumed, or the summary is sized as the item column and
      // nothing is left flexible.
      const id =
        column.id ??
        ("accessorKey" in column && typeof column.accessorKey === "string"
          ? column.accessorKey
          : "");
      // The flex column takes no width and no handle — `TableHead` only writes
      // a width for a column that can resize, so leaving it out is what lets it
      // stretch.
      const flexible = id === FLEX_COLUMN;
      return {
        ...column,
        enableSorting: !nested,
        enableResizing: !flexible,
        ...(flexible ? {} : { size: sizes[id], minSize: MIN_COLUMN }),
      };
    });
  }

  const sizes = COLUMN_SIZES[grouping];
  // The fixed columns (dragged widths, defaults for the rest) plus the floor
  // under the summary. It is the table's MINIMUM width: narrower than this the
  // row scrolls sideways, wider and the summary swallows the difference.
  const totalWidth =
    SUMMARY_MIN +
    Object.keys(sizes).reduce(
      (total, id) => total + (columnSizing[id] ?? sizes[id]),
      0,
    );

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-10 text-center shadow-card">
        <p className="text-sm text-muted-foreground">No items match.</p>
      </div>
    );
  }

  const table = (input: WorkItemRow[]) => {
    // Each table builds its own tree, so a grouped card nests only the work
    // that is actually in it.
    const { rows, tree } = treeOf(input);
    const orderedIds = rows.map((item) => item.id);
    return (
      // Wide content scrolls inside its own container, never the page body.
      <div className="overflow-x-auto">
        <TableProvider
          columns={columnsFor(tree, orderedIds)}
          data={rows}
          className="table-fixed"
          style={{ width: "100%", minWidth: totalWidth }}
          enableColumnResizing
          columnSizing={columnSizing}
          onColumnSizingChange={setColumnSizing}
        >
          <TableHeader>
            {({ headerGroup }) => (
              <TableHeaderGroup key={headerGroup.id} headerGroup={headerGroup}>
                {({ header }) => (
                  <TableHead
                    key={header.id}
                    header={header}
                    label={COLUMN_LABELS[header.column.id]}
                  />
                )}
              </TableHeaderGroup>
            )}
          </TableHeader>
          <TableBody>
            {({ row }) => {
              // TanStack hands the row back as `Row<unknown>`; the data going
              // in is this view's own, so the cast is a re-statement of what
              // was passed to `TableProvider`, not a claim about anything new.
              const item = row.original as WorkItemRow;
              return (
                <ItemMenu key={row.id} context={menu} item={item}>
                  <TableRow
                    row={row}
                    className={cn(
                      "group/row",
                      // Selection is a filled violet-tint block, never an edge.
                      menu.selection.ids.has(item.id) && "bg-secondary",
                    )}
                  >
                    {({ cell }) => (
                      <TableCell
                        key={cell.id}
                        cell={cell}
                        className="truncate"
                      />
                    )}
                  </TableRow>
                </ItemMenu>
              );
            }}
          </TableBody>
        </TableProvider>
      </div>
    );
  };

  if (!grouped) {
    return (
      <div className="rounded-lg border border-border bg-card p-2 shadow-card">
        {table(items)}
      </div>
    );
  }

  // Sprint order as the project states it, then the unscheduled pile. A sprint
  // with nothing in it is left out — an empty table is not a drop target here
  // the way an empty group card is in the list view.
  const buckets = [
    ...sprints.map((sprint) => ({
      sprint,
      rows: items.filter((item) => item.sprintId === sprint.id),
    })),
    {
      sprint: null as BacklogSprintRow | null,
      rows: items.filter((item) => item.sprintId === null),
    },
  ].filter((bucket) => bucket.rows.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {buckets.map((bucket) => (
        <section
          key={bucket.sprint?.id ?? "backlog"}
          className="rounded-lg border border-border bg-card shadow-card"
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-md bg-chip"
            >
              {bucket.sprint ? (
                <IconRocket className="size-4.5 text-brand" />
              ) : (
                <IconStack2 className="size-4.5 text-muted-foreground" />
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <h3 className="truncate font-heading text-[15px] font-semibold tracking-tight">
                  {bucket.sprint ? bucket.sprint.name : "Backlog"}
                </h3>
                <Pill className="tabular-nums">{bucket.rows.length}</Pill>
              </span>
              <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                {bucket.sprint ? (
                  <>
                    <IconCalendar className="size-3.5" aria-hidden />
                    {formatIsoShort(bucket.sprint.startDate)} –{" "}
                    {formatIsoShort(bucket.sprint.endDate)}
                  </>
                ) : (
                  "Unscheduled"
                )}
              </span>
            </span>
            {bucket.sprint ? (
              <SprintStateBadge state={bucket.sprint.state} />
            ) : null}
          </header>
          <div className="p-2">{table(bucket.rows)}</div>
        </section>
      ))}
    </div>
  );
}
