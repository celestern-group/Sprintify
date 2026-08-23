"use client";

import { CrosshairIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type BacklogMenuContext,
  ItemMenu,
} from "@/components/app/backlog/item-context-menu";
import { isSelectionClick } from "@/components/app/backlog/selection";
import type {
  BacklogGrouping,
  MovePayload,
} from "@/components/app/backlog/types";
import {
  type GanttApi,
  type GanttFeature,
  GanttFeatureItem,
  GanttFeatureList,
  GanttFeatureListGroup,
  GanttHeader,
  GanttProvider,
  GanttSidebar,
  GanttSidebarGroup,
  GanttSidebarItem,
  GanttTimeline,
  GanttToday,
  type Range,
} from "@/components/kibo-ui/gantt";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  reviveStringArray,
  usePersistedChoice,
  usePersistedState,
} from "@/hooks/use-persisted-state";
import type {
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemRow,
} from "@/lib/actions/work-items";
import { rescheduleWorkItem } from "@/lib/actions/work-items";
import { isoToLocalDate, localDateToIso } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { buildTreeRows } from "@/lib/work-item-tree";

/**
 * Indent per depth, as a class rather than a style: `GanttSidebarItem` takes a
 * className and already sets `px-3`, so the deeper value has to be a real class
 * for tailwind-merge to override it. Four levels is the hierarchy's own ceiling
 * (Sub-task → Standard → Feature → Epic).
 */
const INDENT_CLASSES = ["", "pl-7", "pl-11", "pl-15"] as const;

/** buildTreeRows takes them; a bar carries no roll-up chip. */
const NO_ROLLUPS = new Map();

/** A save the server has taken, and the dates it replaced — see `pending`. */
type PendingMove = {
  startDate: WorkItemRow["startDate"];
  dueDate: WorkItemRow["dueDate"];
  fromStart: WorkItemRow["startDate"];
  fromDue: WorkItemRow["dueDate"];
};

const RANGES: { value: Range; label: string }[] = [
  { value: "daily", label: "Days" },
  { value: "weekly", label: "Weeks" },
  { value: "monthly", label: "Months" },
  { value: "quarterly", label: "Quarters" },
];

/** The same set as a plain value list — what the stored zoom is checked against. */
const RANGE_VALUES: readonly Range[] = RANGES.map((entry) => entry.value);

/** Stable "nothing folded" identity for the persisted fold list. */
const NONE_COLLAPSED: string[] = [];

// Gantt bar colours are inline styles and can't read CSS variables (same
// constraint as src/lib/gantt-adapter.ts). Resolved v0.3 chart anchors, by
// status category — keep in step with --chart-1 / --chart-2 / --chart-3.
// To do takes violet (planned work, same as an active sprint's bar) rather
// than the chips' neutral grey: on the timeline a grey bar reads as disabled,
// not as "scheduled".
const CATEGORY_COLORS: Record<string, string> = {
  todo: "#6d4aff",
  in_progress: "#2f6bff",
  done: "#12b886",
};

/**
 * Items on a date axis. Only items that carry dates can be drawn, so anything
 * undated is listed underneath rather than silently dropped — a chart that
 * hides half the backlog is worse than one that says so.
 *
 * `grouping` is the toolbar's, shared with every other view: off, the bars are
 * one continuous ranked list; on, they band into a labelled section per sprint.
 *
 * Dragging a bar rewrites the item's own start/due dates. As on the sprint
 * timeline, drag is a MOUSE-ONLY enhancement: every item is also editable
 * through its dialog, which is the guaranteed keyboard path.
 */
export function TimelineView({
  items,
  sprints,
  statuses,
  menu,
  grouping,
  nested,
  canEdit,
  canReorder,
  onOpen,
  onMoved,
  onReordered,
}: {
  items: WorkItemRow[];
  sprints: BacklogSprintRow[];
  statuses: WorkflowStatusRow[];
  /** The right-click menu's catalogs, rights and shared selection. */
  menu: BacklogMenuContext;
  /** One continuous list of bars, or one labelled band per sprint. */
  grouping: BacklogGrouping;
  /** Rows in tree order, children indented under their parent in the sidebar. */
  nested: boolean;
  canEdit: boolean;
  canReorder: boolean;
  onOpen: (item: WorkItemRow) => void;
  onMoved: (payload: MovePayload) => void;
  onReordered: (payload: MovePayload) => void;
}) {
  const [range, setRange] = usePersistedChoice<Range>(
    "timeline.range",
    "weekly",
    RANGE_VALUES,
  );
  const ganttRef = useRef<GanttApi | null>(null);
  // Folded parents, by item id. Held here rather than in the toolbar because
  // it is a property of this view's rows — the list view keeps its own. Stored
  // as an ARRAY because a Set doesn't survive JSON; the Set is derived for the
  // lookups the tree builder does per row.
  const [collapsed, setCollapsed] = usePersistedState<string[]>(
    "timeline.collapsed",
    NONE_COLLAPSED,
    reviveStringArray,
  );
  const collapsedIds = useMemo<ReadonlySet<string>>(
    () => new Set(collapsed),
    [collapsed],
  );

  const toggleCollapsed = useCallback(
    (id: string) => {
      setCollapsed((current) =>
        current.includes(id)
          ? current.filter((entry) => entry !== id)
          : [...current, id],
      );
    },
    [setCollapsed],
  );

  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status])),
    [statuses],
  );

  /**
   * Dates the server has already accepted, held until the page has re-read
   * them. `onMoved` refreshes the route, which is a round trip, and the bar
   * stops tracking the pointer the moment this component's save resolves —
   * without this it would fall back to the old dates for those frames and
   * rubber-band back and forth.
   *
   * An entry is dropped as soon as the incoming item stops showing the dates it
   * was recorded against; whatever it shows instead is the truth, including a
   * range the server clamped. Keyed off the VALUES rather than the `items`
   * identity, which is a fresh filtered array on every render of the panel.
   */
  const [pending, setPending] = useState<ReadonlyMap<string, PendingMove>>(
    () => new Map(),
  );

  if (pending.size > 0) {
    const settled = [...pending].filter(([id, move]) => {
      const item = items.find((candidate) => candidate.id === id);
      return (
        !item ||
        item.startDate !== move.fromStart ||
        item.dueDate !== move.fromDue
      );
    });
    if (settled.length > 0) {
      // Adjusting state during render rather than in an effect — an effect
      // would paint the superseded dates for a frame first.
      const next = new Map(pending);
      for (const [id] of settled) next.delete(id);
      setPending(next);
    }
  }

  // An item's own dates win; failing that it borrows its sprint's, so a planned
  // item still appears on the axis where the work is scheduled to happen.
  const dated = useMemo(() => {
    const sprintById = new Map(sprints.map((sprint) => [sprint.id, sprint]));
    return items
      .map((item) => {
        const sprint = item.sprintId ? sprintById.get(item.sprintId) : null;
        const saved = pending.get(item.id);
        const startDate =
          saved?.startDate ?? item.startDate ?? sprint?.startDate ?? null;
        const dueDate =
          saved?.dueDate ?? item.dueDate ?? sprint?.endDate ?? null;
        if (!startDate || !dueDate) return null;
        const status = statusById.get(item.statusId);
        return {
          item,
          borrowed: !saved && !item.startDate && !item.dueDate,
          group: sprint?.name ?? "Backlog",
          feature: {
            id: item.id,
            name: `${item.key} · ${item.summary}`,
            startAt: isoToLocalDate(startDate),
            endAt: isoToLocalDate(dueDate),
            status: {
              id: item.statusId,
              name: status?.name ?? "Status",
              color: CATEGORY_COLORS[status?.category ?? "todo"],
            },
          } satisfies GanttFeature,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [items, sprints, statusById, pending]);

  const undated = items.filter(
    (item) => !dated.some((row) => row.item.id === item.id),
  );

  const grouped = grouping === "sprint";

  /**
   * Rank order, or tree order with a depth per row. The sidebar and the bars
   * walk the SAME array — the two halves are aligned by position alone, so a
   * name and its bar part company the moment they are ordered separately.
   */
  const ordered = useMemo(() => {
    function order(rows: typeof dated) {
      if (!nested)
        return rows.map((row) => ({
          row,
          depth: 0,
          hasChildren: false,
          collapsed: false,
        }));
      const byId = new Map(rows.map((row) => [row.item.id, row]));
      return buildTreeRows({
        items: rows.map((row) => row.item),
        // The whole filtered set, so a parent that has no dates of its own is
        // still recognised as the parent rather than splitting its children off
        // as roots.
        allItems: items,
        rollups: NO_ROLLUPS,
        // Folding drops the descendant rows from this array, which is what both
        // halves walk — so the names and their bars disappear together.
        collapsed: collapsedIds,
        // An undrawable parent has no row to hang context off here: a Gantt row
        // exists to carry a bar, and a bar needs dates.
        ghostParents: false,
      })
        .map((node) => {
          const row = byId.get(node.item.id);
          return row
            ? {
                row,
                depth: node.depth,
                hasChildren: node.hasChildren,
                collapsed: node.collapsed,
              }
            : null;
        })
        .filter((entry) => entry !== null);
    }

    const byGroup = new Map<string, typeof dated>();
    for (const row of dated) {
      const list = byGroup.get(row.group) ?? [];
      list.push(row);
      byGroup.set(row.group, list);
    }

    return {
      flat: order(dated),
      groups: [...byGroup.entries()].map(
        ([name, rows]) => [name, order(rows)] as const,
      ),
    };
  }, [dated, items, nested, collapsedIds]);

  async function handleMove(id: string, startAt: Date, endAt: Date | null) {
    const row = dated.find((candidate) => candidate.item.id === id);
    if (!row) return;
    const item = row.item;

    const startDate = localDateToIso(startAt);
    const dropped = endAt ? localDateToIso(endAt) : startDate;
    const dueDate = dropped >= startDate ? dropped : startDate;

    try {
      // Dates only. This view holds a list row, not the whole item — sending it
      // through the full-replace `updateWorkItem` would null every prose block
      // the row never loaded.
      await rescheduleWorkItem({
        workItemId: item.id,
        startDate,
        dueDate,
      });
      // Hold what was saved until the refetch below lands; re-reading is still
      // what keeps the bar honest if the server clamped the range.
      setPending((current) =>
        new Map(current).set(item.id, {
          startDate,
          dueDate,
          fromStart: item.startDate,
          fromDue: item.dueDate,
        }),
      );
      onMoved({ workItemId: item.id });
      toast.success(`${item.key} rescheduled.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't reschedule that item.",
      );
    }
  }

  /**
   * Every drawn row in reading order, which is what a shift-range spans. Only
   * dated rows are here — an item with no bar has no row to pick.
   */
  const orderedIds = grouped
    ? ordered.groups.flatMap(([, rows]) => rows.map(({ row }) => row.item.id))
    : ordered.flat.map(({ row }) => row.item.id);

  /** Ctrl/⌘-click adds to the selection, shift-click extends a range — a Gantt
   *  row is a fixed-height slot aligned to a bar, with nowhere to put a tick
   *  box, so the modifier IS the gesture here (as on the board). */
  function selectionClick(event: ReactMouseEvent, itemId: string): boolean {
    if (!isSelectionClick(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    menu.selection.select(itemId, { extend: event.shiftKey, orderedIds });
    return true;
  }

  /**
   * The Gantt's bar drag owns dates, not rows. Reordering therefore uses the
   * context menu and names the two adjacent persisted-rank neighbours, exactly
   * like the list's drag-and-drop does. Excluding the moving row first matters:
   * moving B later in A/B/C is a drop after C, not between B and C.
   */
  function reorderAt(
    item: WorkItemRow,
    rows: readonly (typeof ordered.flat)[number][],
    insertionIndex: number,
  ) {
    const index = rows.findIndex(({ row }) => row.item.id === item.id);
    const remaining = rows.filter(({ row }) => row.item.id !== item.id);
    if (index < 0 || insertionIndex < 0 || insertionIndex > remaining.length)
      return;
    onReordered({
      workItemId: item.id,
      beforeId: remaining[insertionIndex - 1]?.row.item.id ?? null,
      afterId: remaining[insertionIndex]?.row.item.id ?? null,
    });
  }

  function reorder(
    item: WorkItemRow,
    rows: readonly (typeof ordered.flat)[number][],
    direction: "earlier" | "later",
  ) {
    const index = rows.findIndex(({ row }) => row.item.id === item.id);
    const insertionIndex = direction === "earlier" ? index - 1 : index + 1;
    if (index < 0 || insertionIndex < 0 || insertionIndex >= rows.length) {
      toast.info(
        direction === "earlier"
          ? `${item.key} is already first in this timeline.`
          : `${item.key} is already last in this timeline.`,
      );
      return;
    }
    reorderAt(item, rows, insertionIndex);
  }

  /** One sidebar row: the name, its disclosure, and the right-click menu. */
  function sidebarRow(
    { row, depth, hasChildren, collapsed }: (typeof ordered.flat)[number],
    siblings: readonly (typeof ordered.flat)[number][],
  ) {
    const item = row.item;
    return (
      <ItemMenu
        key={item.id}
        context={menu}
        item={item}
        canReorder={canReorder}
        onReorder={(direction) => reorder(item, siblings, direction)}
      >
        {/* The menu hangs off a wrapper: `GanttSidebarItem` is a component
            that keeps its own div, and Base UI's trigger needs a real element
            to clone. The wrapper adds no height of its own. */}
        <div
          className={cn(menu.selection.ids.has(item.id) && "bg-secondary")}
          onClickCapture={(event) => selectionClick(event, item.id)}
        >
          <GanttSidebarItem
            className={INDENT_CLASSES[Math.min(depth, 3)]}
            feature={row.feature}
            hasChildren={hasChildren}
            collapsed={collapsed}
            // The name is the row's own affordance: without this the sidebar
            // row goes inert (no tab stop, no hover, no jump to the bar) and
            // the only way in is the bar's label.
            onSelectItem={() => onOpen(item)}
            onToggle={nested ? () => toggleCollapsed(item.id) : undefined}
          />
        </div>
      </ItemMenu>
    );
  }

  /** One bar. Its label is the trigger, so right-clicking the bar itself works
   *  — the bar's own body belongs to the drag. */
  function bar(
    { row }: (typeof ordered.flat)[number],
    siblings: readonly (typeof ordered.flat)[number][],
  ) {
    const item = row.item;
    return (
      <GanttFeatureItem
        key={item.id}
        {...row.feature}
        onMove={canEdit ? handleMove : undefined}
      >
        <ItemMenu
          context={menu}
          item={item}
          canReorder={canReorder}
          onReorder={(direction) => reorder(item, siblings, direction)}
        >
          <button
            type="button"
            onClick={(event) => {
              if (selectionClick(event, item.id)) return;
              onOpen(item);
            }}
            className={cn(
              "flex-1 truncate text-left text-xs",
              menu.selection.ids.has(item.id) && "font-bold underline",
            )}
          >
            {row.feature.name}
          </button>
        </ItemMenu>
      </GanttFeatureItem>
    );
  }

  if (dated.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center shadow-card">
        <p className="font-semibold text-sm">No scheduled items</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Set start and due dates, or plan items into a sprint, and they appear
          here.
        </p>
      </div>
    );
  }

  return (
    // The chart owns the rest of the viewport, like the board does: the toolbar
    // and legend keep their natural height and the gantt takes what's left,
    // scrolling inside itself rather than leaving dead canvas below.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <fieldset className="flex items-center gap-1.5 border-0 p-0">
            {RANGES.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={option.value === range ? "secondary" : "outline"}
                aria-pressed={option.value === range}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </fieldset>
          <span
            aria-hidden="true"
            className="mx-0.5 hidden h-4 w-px bg-border sm:block"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => ganttRef.current?.scrollToDate(new Date())}
          >
            <CrosshairIcon aria-hidden="true" />
            Today
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? "Drag a bar to reschedule, or open an item to edit its dates."
            : "Open an item to see its dates."}
        </p>
      </div>

      {/* No `min-h-*` floor: a floor is exactly what pushes the chart past the
          shell on a short window. It takes the space that is left and scrolls
          its own rows. */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <GanttProvider
          range={range}
          zoom={100}
          className="h-full"
          apiRef={ganttRef}
        >
          <GanttSidebar label="Item">
            {grouped ? (
              ordered.groups.map(([name, rows]) => (
                <GanttSidebarGroup key={name} name={name}>
                  {rows.map((entry) => sidebarRow(entry, rows))}
                </GanttSidebarGroup>
              ))
            ) : (
              // The hairlines between rows live on the group wrapper, so a
              // flat sidebar has to bring its own.
              <div className="divide-y divide-border">
                {ordered.flat.map((entry) => sidebarRow(entry, ordered.flat))}
              </div>
            )}
          </GanttSidebar>
          <GanttTimeline>
            <GanttHeader />
            {/* The two halves must agree row for row: a sidebar group spends
                one row height on its label, and `GanttFeatureListGroup` pads by
                exactly that. Ungrouped there is no label on either side, so the
                bars hang directly off the list or every one of them drifts down
                by a row. */}
            <GanttFeatureList>
              {grouped ? (
                ordered.groups.map(([name, rows]) => (
                  <GanttFeatureListGroup key={name}>
                    {rows.map((entry) => bar(entry, rows))}
                  </GanttFeatureListGroup>
                ))
              ) : (
                // `GanttFeatureList` is `space-y-4`: that gap belongs BETWEEN
                // groups, and the sidebar spends it the same way. Ungrouped,
                // the bars go in one wrapper — hand them over as N children
                // and every row past the first drifts 16px below its name.
                <div>
                  {ordered.flat.map((entry) => bar(entry, ordered.flat))}
                </div>
              )}
            </GanttFeatureList>
            <GanttToday />
          </GanttTimeline>
        </GanttProvider>
      </div>

      {/* The bars carry a colour per status category; this names them, so the
          chart stays readable under colour-vision deficiency — and lists what
          the axis can't show. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {Object.entries(CATEGORY_COLORS).map(([category, color]) => (
          <span key={category} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            {category === "in_progress"
              ? "In progress"
              : category === "done"
                ? "Done"
                : "To do"}
          </span>
        ))}
        {dated.some((row) => row.borrowed) ? (
          <span>
            Items without their own dates are drawn across their sprint&apos;s.
          </span>
        ) : null}
        {undated.length > 0 ? (
          <span>
            {undated.length} item{undated.length === 1 ? "" : "s"} not shown —
            no dates and no sprint.
          </span>
        ) : null}
      </div>
    </div>
  );
}
