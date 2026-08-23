"use client";

import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { pointerWithin, rectIntersection, useDroppable } from "@dnd-kit/core";
import {
  IconCalendar,
  IconChevronDown,
  IconCornerDownRight,
  IconPlus,
  IconRocket,
  IconStack2,
  IconUnlink,
  IconUser,
} from "@tabler/icons-react";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  describeEstimate,
  useEstimates,
  useItemEstimate,
} from "@/components/app/backlog/estimate-context";
import { ItemRowIcons } from "@/components/app/backlog/item-card";
import {
  type BacklogMenuContext,
  ItemMenu,
} from "@/components/app/backlog/item-context-menu";
import {
  type ItemSelection,
  SelectBox,
} from "@/components/app/backlog/selection";
import type {
  BacklogGrouping,
  ComposerSeed,
  MoveItemsPayload,
  MovePayload,
} from "@/components/app/backlog/types";
import {
  StatusChip,
  typeById,
  WorkItemTypeIcon,
} from "@/components/app/backlog/work-item-visuals";
import { SprintStateBadge } from "@/components/app/sprint-state-badge";
import { UserGlimpse } from "@/components/app/user-glimpse";
import {
  ListGroup,
  ListHeader,
  ListItem,
  ListItemDragHandle,
  ListItems,
  ListProvider,
} from "@/components/kibo-ui/list";
import { Pill } from "@/components/kibo-ui/pill";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type {
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemRow,
  WorkItemTypeRow,
} from "@/lib/actions/work-items";
import { formatIsoShort } from "@/lib/date-only";
import { effectiveEstimates, sumEstimates } from "@/lib/estimate-rollup";
import { cn } from "@/lib/utils";
import {
  buildTreeRows,
  canNestUnder,
  resolveSiblingRow,
  rollupsOf,
  type TreeRow,
} from "@/lib/work-item-tree";
import { initialsOf } from "@/lib/work-items";

const BACKLOG_GROUP = "backlog";
/** The single group that holds everything when grouping is off. */
const ALL_GROUP = "all";
const ITEM_PREFIX = "item:";
const BEFORE_PREFIX = "before:";
const AFTER_PREFIX = "after:";
const NEST_PREFIX = "nest:";
/**
 * "Append as the last child of <item>", drawn where that item's subtree ENDS:
 * `seam:<group>|<parentItem>`, with an empty parent meaning top level.
 *
 * A row's own bands only ever offer that row's own depth, and the end of a
 * level is the one position no row can express: when several subtrees close at
 * the same seam, the rows either side of it belong to the innermost and the
 * outermost level, and every level between them has nowhere to drop.
 *
 * Semantically this is the NEST band pointed at an ancestor rather than at the
 * row under the cursor, and it is handled by exactly that code path. It needs
 * its own prefix because `nest:<group>|<item>` already belongs to that
 * ancestor's own row, and two droppables sharing an id fight over every drop.
 */
const SEAM_PREFIX = "seam:";

const BAND_PREFIXES = [BEFORE_PREFIX, AFTER_PREFIX, NEST_PREFIX, SEAM_PREFIX];

/**
 * What the pointer should prefer when several droppables contain it. The seam
 * strip sits INSIDE the group card, so without this the card (a droppable in
 * its own right) would win and the drop would fall back to "end of group,
 * parent untouched" — the very behaviour the strip exists to override.
 */
const PRIORITY_PREFIXES = BAND_PREFIXES;

/**
 * Drop-target ids carry the GROUP as well as the item: `before:<group>|<item>`.
 *
 * The same item is a real row in its own sprint card and a CONTEXT row in every
 * card its children landed in, so an id keyed on the item alone collided —
 * which is why context rows shipped inert, and why half of a grouped card was a
 * dead zone you could not drop against. Namespacing by group makes every row in
 * every card its own target, and it means the drop knows which CARD it landed
 * in rather than inferring the sprint from whichever row it resolved to.
 *
 * `|` is safe as the separator: group ids are uuids or the two literals below,
 * and item ids are uuids.
 */
const BAND_SEP = "|";

function bandId(prefix: string, groupId: string, itemId: string): string {
  return `${prefix}${groupId}${BAND_SEP}${itemId}`;
}

function parseBandId(
  overId: string,
): { prefix: string; groupId: string; itemId: string } | null {
  const prefix = [...BAND_PREFIXES, ITEM_PREFIX].find((candidate) =>
    overId.startsWith(candidate),
  );
  if (!prefix) return null;
  const rest = overId.slice(prefix.length);
  const at = rest.indexOf(BAND_SEP);
  if (at < 0) return null;
  return { prefix, groupId: rest.slice(0, at), itemId: rest.slice(at + 1) };
}

/** One indent step, in px. Small enough that four levels still leave room. */
const INDENT = 18;

/**
 * The trailing metadata is a COLUMN GRID, not a flex pile.
 *
 * Every cell here is optional — most rows carry a status and an assignee, few
 * carry a roll-up, a sprint, labels and a due date all at once — so laying them
 * out with `ml-auto` alone makes each row start its metadata wherever its own
 * content happens to end, and nothing lines up down the list. Each slot instead
 * keeps a fixed width whether or not it has anything in it, so the roll-up bars
 * sit over the roll-up bars and the avatars over the avatars.
 *
 * The widths are per-cell rather than one grid template because the slots drop
 * out at different breakpoints (status at `sm`, dates at `lg`, labels at `xl`)
 * — a real grid would need a different template at every one of them.
 */
const META = {
  rollup: "w-[68px] justify-end",
  sprint: "w-28 justify-end",
  labels: "w-28 justify-end",
  due: "w-[86px] justify-end",
  // Left-aligned on purpose: status chips vary in width ("Done" vs "In
  // progress") and it is their glyphs that should form the column.
  status: "w-[104px] justify-start",
  points: "w-6 justify-end",
  avatar: "w-6 justify-center",
} as const;

/** One fixed-width slot of the metadata rail; empty ones still hold their place. */
function MetaCell({
  className,
  children,
}: {
  className: string;
  children?: ReactNode;
}) {
  return (
    <span className={cn("flex shrink-0 items-center", className)}>
      {children}
    </span>
  );
}

/**
 * Pointer-first collision, because the drop targets are now BANDS stacked
 * inside a row (before / nest / after). Rect intersection compares areas, so
 * the full-width row would always beat a third of itself and the bands would
 * be unreachable. Falls back to rects once the pointer leaves every droppable
 * (dropping in the gutter of a group card still schedules).
 */
const bandAwareCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length === 0) return rectIntersection(args);
  const band = pointer.find((collision) =>
    PRIORITY_PREFIXES.some((prefix) => String(collision.id).startsWith(prefix)),
  );
  return band ? [band] : pointer;
};

/**
 * The ranked backlog, on Kibo UI's List primitives.
 *
 * By default it is ONE list of everything, in rank order, with each row naming
 * the sprint it belongs to — the sprint filter in the toolbar is how you narrow
 * to one. With `grouping="sprint"` it splits into one group per open sprint
 * plus everything unscheduled, which is the planning posture: dragging a row
 * into a sprint group schedules it, dropping it onto another row places it
 * there, and both are the same server move. Ungrouped, a drag only ever
 * re-ranks or re-parents — it never silently changes which sprint an item is
 * in, because there is no sprint boundary on screen to have crossed.
 *
 * Kibo's List only registers GROUPS as droppables, which would give scheduling
 * but no ordering — and ordering is the entire point of a backlog. So each row
 * carries its own drop bands here and the handler reads whichever id the
 * pointer landed on: a band means "put it here", a group means "put it at the
 * end".
 *
 * With `nested` on, the flat rank list becomes a TREE: children render indented
 * under a parent that sits in the SAME group, and each row exposes three bands
 * — drop above or below to re-rank as a sibling, drop on the middle to make the
 * dragged item a CHILD of that row. A child whose parent lives in another
 * sprint stays at top level with a hint rather than disappearing.
 */
export function BacklogListView({
  items,
  allItems,
  sprints,
  statuses,
  types,
  menu,
  canMove,
  canNest,
  canCreate,
  nested,
  grouping,
  capacityUnit,
  onOpen,
  onMove,
  onMoveMany,
  onUnnest,
  onCompose,
}: {
  /** The filtered, rank-ordered list actually rendered. */
  items: WorkItemRow[];
  /** Every item in the project — roll-ups and parent hints must not lie when
   *  a filter is hiding half the tree. */
  allItems: WorkItemRow[];
  sprints: BacklogSprintRow[];
  statuses: WorkflowStatusRow[];
  types: WorkItemTypeRow[];
  /** The right-click menu's catalogs, rights and shared selection. */
  menu: BacklogMenuContext;
  canMove: boolean;
  /** `item:update` — re-parenting is an edit, not a re-rank. */
  canNest: boolean;
  canCreate: boolean;
  nested: boolean;
  /** One list of everything, or one card per sprint. */
  grouping: BacklogGrouping;
  capacityUnit: "hours" | "points";
  onOpen: (item: WorkItemRow) => void;
  onMove: (payload: MovePayload) => void;
  /** A checked group dropped as one ordered block. */
  onMoveMany: (payload: MoveItemsPayload) => void;
  onUnnest: (item: WorkItemRow) => void;
  /** Opens the panel's inline composer, seeded with the section pressed. */
  onCompose: (seed: ComposerSeed) => void;
}) {
  // Collapsed groups stay droppable (a drop lands at the end of the hidden
  // list), so folding a finished sprint away doesn't take its drop target with
  // it. Not persisted — it's a reading posture, not a preference.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  // Folded parents, same reasoning as groups and the same non-persistence.
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
  // The row being dragged, rendered into the ListProvider's DragOverlay —
  // group cards are overflow-hidden, so only a portaled preview stays visible
  // once the pointer leaves the source card.
  const [activeItem, setActiveItem] = useState<WorkItemRow | null>(null);
  // A grip on a checked row carries the visible selection. Hidden filtered rows
  // are not included: a drag should only move what the user can see.
  const [activeItems, setActiveItems] = useState<WorkItemRow[]>([]);
  const activeItemsRef = useRef<WorkItemRow[]>([]);
  // What the pending drop would do, in words, rendered under the drag preview.
  // The bands are thirds of a ~44px row, so the highlight inside one is a few
  // pixels of tint — legible once you know what to look for, useless while you
  // are still learning which third means "nest".
  const [dropCaption, setDropCaption] = useState<string | null>(null);

  function toggle(groupId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (!next.delete(groupId)) next.add(groupId);
      return next;
    });
  }

  function toggleFold(itemId: string) {
    setFoldedIds((current) => {
      const next = new Set(current);
      if (!next.delete(itemId)) next.add(itemId);
      return next;
    });
  }

  const byId = useMemo(
    () => new Map(allItems.map((item) => [item.id, item])),
    [allItems],
  );

  const rollups = useMemo(() => {
    const doneIds = new Set(
      statuses
        .filter((status) => status.category === "done")
        .map((status) => status.id),
    );
    return rollupsOf(allItems, (item) => doneIds.has(item.statusId));
  }, [allItems, statuses]);

  // Estimates come from the panel's one pass over the project; the local
  // fallback keeps the view correct if it is ever rendered on its own.
  const provided = useEstimates();
  const estimates = useMemo(
    () => provided ?? effectiveEstimates(allItems),
    [provided, allItems],
  );

  const grouped = grouping === "sprint";

  const groups = useMemo(() => {
    // Completed sprints aren't drop targets — an item can't be scheduled into
    // a sprint that already closed (the server refuses it too).
    const openSprints = sprints.filter(
      (sprint) => sprint.state !== "completed",
    );
    const buckets = grouped
      ? [
          ...openSprints.map((sprint) => ({
            id: sprint.id,
            sprint,
            items: items.filter((item) => item.sprintId === sprint.id),
          })),
          {
            id: BACKLOG_GROUP,
            sprint: null as BacklogSprintRow | null,
            items: items.filter((item) => item.sprintId === null),
          },
        ]
      : // One bucket, so a parent appears exactly once instead of being ghosted
        // into every sprint card its children landed in.
        [
          {
            id: ALL_GROUP,
            sprint: null as BacklogSprintRow | null,
            items,
          },
        ];

    return buckets.map((bucket) => ({
      ...bucket,
      rows: nested
        ? buildTreeRows({
            items: bucket.items,
            allItems,
            rollups,
            collapsed: foldedIds,
          })
        : // Flat mode still renders through TreeRow so there is one row
          // component, one set of drop bands and one code path.
          bucket.items.map<TreeRow>((item, index) => ({
            item,
            depth: 0,
            parentId: null,
            siblings: bucket.items,
            // Flat mode draws no ghosts, so position and rank position agree.
            rankIndex: index,
            hasChildren: false,
            collapsed: false,
            ghost: false,
            detachedParent: null,
            rollup: rollups.get(item.id) ?? null,
          })),
    }));
  }, [items, allItems, sprints, nested, grouped, rollups, foldedIds]);

  const rowsById = useMemo(() => {
    const map = new Map<string, TreeRow>();
    for (const group of groups) {
      for (const row of group.rows) {
        // An item can be a real row in its own group AND a ghost in every group
        // its children landed in. The real one is the row that owns it.
        const existing = map.get(row.item.id);
        if (existing && !existing.ghost) continue;
        map.set(row.item.id, row);
      }
    }
    return map;
  }, [groups]);

  /**
   * Per-group row lookups, because walking the tree is a WITHIN-CARD operation.
   *
   * `rowsById` is global and resolves an item to its one real row wherever that
   * lives. `resolveSiblingRow` walks up the ancestor chain, so with a global map
   * a drop into Sprint 4's card could walk onto a parent whose real row sits in
   * Sprint 1's card — and the sprint was then read off THAT row, silently
   * rescheduling the item into a sprint the user never dropped on. Scoped to the
   * card, the walk can only reach rows drawn in it, and a ghost parent there is
   * refused by the existing check instead of being followed into another group.
   */
  const rowsByGroup = useMemo(() => {
    const map = new Map<string, Map<string, TreeRow>>();
    for (const group of groups) {
      map.set(group.id, new Map(group.rows.map((row) => [row.item.id, row])));
    }
    return map;
  }, [groups]);

  /**
   * Every selectable row, in the order the cards draw them — what a shift-click
   * range is measured against. Ghost rows are left out: their real row lives in
   * another card, so counting both would put the same item in a range twice.
   */
  const selectableIds = useMemo(
    () =>
      groups.flatMap((group) =>
        group.rows.filter((row) => !row.ghost).map((row) => row.item.id),
      ),
    [groups],
  );

  // `groupIdOfItem` used to live here, mapping an item back to the card it was
  // rendered in so a drop could work out the sprint. It is gone: the drop
  // target's own id now carries the group (see `bandId`), so the card is read
  // from what the pointer actually hit rather than inferred from whichever row
  // the tree walk resolved to — which is what let a drop into one sprint
  // reschedule the item into another.

  function handleDragStart(event: DragStartEvent) {
    const active = items.find((row) => row.id === event.active.id) ?? null;
    setActiveItem(active);
    const moving =
      active && menu.selection.ids.has(active.id)
        ? items.filter((row) => menu.selection.ids.has(row.id))
        : active
          ? [active]
          : [];
    activeItemsRef.current = moving;
    setActiveItems(moving);
  }

  /**
   * What a drop on `overId` would DO — the payload plus a sentence naming it.
   *
   * One function rather than two, because the caption shown while dragging and
   * the move fired on release have to be the same decision. When they were
   * computed separately the banner was free to promise a placement the handler
   * then refused, which is worse than no banner at all.
   *
   * `move: null` means "this drop is a no-op" — refused, or already exactly
   * there — and the caption says so instead of the banner going blank.
   */
  function planDrop(
    overId: string,
    item: WorkItemRow,
  ): { move: MovePayload | null; caption: string } | null {
    const hit = parseBandId(overId);

    if (hit) {
      const { prefix, groupId, itemId } = hit;
      // The CARD decides the sprint. Reading it off whichever row the drop
      // resolved to meant a walk up the tree could land on a parent whose real
      // row lives in another card, and the item was then rescheduled into a
      // sprint the pointer never visited.
      const sprintId = !grouped
        ? undefined
        : groupId === BACKLOG_GROUP
          ? null
          : groupId;
      const scope = rowsByGroup.get(groupId);
      if (!scope) return null;

      // A seam with no item names the TOP level: append after everything at
      // depth 0 in this card, owned by nobody.
      if (prefix === SEAM_PREFIX && itemId === "") {
        if (!canNest)
          return { move: null, caption: "You can't re-parent here" };
        const lastRoot =
          (rowsByGroup.get(groupId)?.values() ?? [])
            ? [...(rowsByGroup.get(groupId)?.values() ?? [])]
                .filter(
                  (row) =>
                    !row.ghost && row.depth === 0 && row.item.id !== item.id,
                )
                .at(-1)
            : undefined;
        return {
          move: {
            workItemId: item.id,
            parentId: null,
            sprintId,
            beforeId: lastRoot?.item.id ?? null,
            afterId: null,
          },
          caption: "Move to the end, at top level",
        };
      }

      // 1. Dropped ON a row: adopt it as parent. A context row is a legitimate
      // parent — it is drawn here precisely because its children are. A seam
      // takes this same path, pointed at an ancestor instead of the hovered row.
      if (prefix === NEST_PREFIX || prefix === SEAM_PREFIX) {
        const parent = byId.get(itemId);
        if (!parent) return null;
        if (!canNest)
          return { move: null, caption: "You can't re-parent here" };
        if (!canNestUnder({ child: item, parent, types, byId })) {
          return { move: null, caption: `Can't nest under ${parent.key}` };
        }

        // Last existing child by rank, so the new one lands at the end of its
        // siblings rather than jumping to the front of them.
        const lastChild = allItems
          .filter((row) => row.parentId === parent.id && row.id !== item.id)
          .at(-1);

        return {
          move: {
            workItemId: item.id,
            parentId: parent.id,
            sprintId,
            beforeId: lastChild?.id ?? parent.id,
            afterId: null,
          },
          caption: `Nest under ${parent.key}`,
        };
      }

      // 2. Dropped between rows: become a sibling of the row it landed against.
      // A seam names the ancestor to land AFTER, so it rides the sibling path
      // unchanged — the only thing that differs is which row it points at.
      const placeBefore = prefix === BEFORE_PREFIX || prefix === ITEM_PREFIX;
      const neighbour = scope.get(itemId);
      if (!neighbour) return null;

      // Adopting the neighbour's parent may be illegal for what's dragged (a
      // Story can't join two Sub-tasks under their Story). `resolveSiblingRow`
      // walks up until it is, so the drop lands one level out instead of being
      // silently refused. Scoped to this card, so the walk can only reach rows
      // actually drawn here.
      const target =
        nested && canNest
          ? resolveSiblingRow({
              neighbour,
              item,
              rowsById: scope,
              types,
              byId,
            })
          : neighbour;
      if (target.item.id === item.id) return null;

      const siblings = target.siblings.filter((row) => row.id !== item.id);

      // A GHOST holds no rank of its own — it is drawn here for context and its
      // real row lives in another card — so above and below it are the same
      // gap: between the rankable siblings on either side. Its `rankIndex` is
      // that gap, shifted left if the row being dragged sat before it.
      let beforeId: string | null;
      let afterId: string | null;
      if (target.ghost) {
        const draggedAt = target.siblings.findIndex(
          (row) => row.id === item.id,
        );
        const cut =
          target.rankIndex -
          (draggedAt >= 0 && draggedAt < target.rankIndex ? 1 : 0);
        beforeId = siblings[cut - 1]?.id ?? null;
        afterId = siblings[cut]?.id ?? null;
      } else {
        const index = siblings.findIndex((row) => row.id === target.item.id);
        if (index < 0) return null;
        beforeId = placeBefore
          ? (siblings[index - 1]?.id ?? null)
          : target.item.id;
        afterId = placeBefore
          ? target.item.id
          : (siblings[index + 1]?.id ?? null);
      }

      // In flat mode the parent is none of this view's business — leaving it
      // `undefined` is what keeps a plain re-rank from detaching an item.
      const parentId = nested && canNest ? target.parentId : undefined;

      // Naming the resulting DEPTH is the whole point of the banner: the bands
      // are ~14px apart and "above PROJ-7" alone never said whether the item
      // would come to rest beside PROJ-7 or inside its parent.
      const where =
        parentId === undefined
          ? ""
          : parentId === null
            ? " · at top level"
            : ` · under ${byId.get(parentId)?.key ?? "its parent"}`;
      // Above and below a ghost resolve to the same gap, so the caption says
      // "beside" rather than promising an order the drop cannot honour.
      const caption = target.ghost
        ? `Place beside ${target.item.key}${where}`
        : `${placeBefore ? "Place above" : "Place below"} ${target.item.key}${where}`;

      // Already exactly there — say nothing rather than write a new rank and
      // an audit entry for a move that didn't move.
      const own = rowsById.get(item.id);
      if (
        own &&
        (sprintId === undefined || (item.sprintId ?? null) === sprintId) &&
        (parentId === undefined || (item.parentId ?? null) === parentId)
      ) {
        const ownIndex = own.siblings.findIndex((row) => row.id === item.id);
        const prev = own.siblings[ownIndex - 1]?.id ?? null;
        const next = own.siblings[ownIndex + 1]?.id ?? null;
        if (prev === beforeId && next === afterId) {
          return { move: null, caption: "Already here" };
        }
      }

      return {
        move: { workItemId: item.id, parentId, sprintId, beforeId, afterId },
        caption,
      };
    }

    // 3. Dropped on the group card itself: end of that group, parent untouched.
    const group = groups.find((row) => row.id === overId);
    if (!group) return null;
    // Context rows belong to other groups; ranking against one would place this
    // item next to work that isn't even in this sprint.
    const placeable = group.rows.filter(
      (row) => !row.ghost && row.item.id !== item.id,
    );
    const last = placeable.at(-1)?.item ?? null;
    const sprintId = grouped ? (group.sprint?.id ?? null) : undefined;
    const groupName =
      group.sprint?.name ?? (group.id === ALL_GROUP ? "All items" : "Backlog");
    const sameSprint =
      sprintId === undefined || (item.sprintId ?? null) === sprintId;
    if (sameSprint && last === null) {
      return { move: null, caption: "Already here" };
    }
    if (
      sameSprint &&
      group.rows.filter((row) => !row.ghost).at(-1)?.item.id === item.id
    ) {
      return { move: null, caption: "Already here" };
    }

    return {
      move: {
        workItemId: item.id,
        sprintId,
        beforeId: last?.id ?? null,
        afterId: null,
      },
      caption: `Move to end of ${groupName}`,
    };
  }

  /** Narrates the pending drop into the overlay while the pointer moves. */
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !canMove) return setDropCaption(null);
    const item = items.find((row) => row.id === active.id);
    if (!item) return setDropCaption(null);
    const plan = planDrop(String(over.id), item);
    if (!plan) return setDropCaption(null);
    const hit = parseBandId(String(over.id));
    const nesting = hit?.prefix === NEST_PREFIX || hit?.prefix === SEAM_PREFIX;
    if (activeItems.length > 1 && nesting) {
      return setDropCaption(
        "Selected items can be reordered together, not nested",
      );
    }
    if (
      activeItems.length > 1 &&
      (activeItems.some((row) => row.id === plan.move?.beforeId) ||
        activeItems.some((row) => row.id === plan.move?.afterId))
    ) {
      return setDropCaption("Drop beside the selected items, not onto them");
    }
    setDropCaption(plan.caption);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    setDropCaption(null);
    if (!canMove) return;
    const { active, over } = event;
    if (!over) return;

    const item = items.find((row) => row.id === active.id);
    if (!item) return;

    const plan = planDrop(String(over.id), item);
    const move = plan?.move;
    if (!move) return;

    const moving =
      activeItemsRef.current.length > 0 ? activeItemsRef.current : [item];
    if (moving.length === 1) return onMove(move);

    // A multi-selection can be ranked or scheduled together, but not nested:
    // different item types may permit different parents and their subtrees must
    // retain their own structure. `parentId` is also present on ordinary
    // before/after drops in the nested list, so only the actual nest bands are
    // rejected — the batch payload itself omits it and preserves hierarchy.
    const hit = parseBandId(String(over.id));
    if (hit?.prefix === NEST_PREFIX || hit?.prefix === SEAM_PREFIX) return;
    const movingIds = new Set(moving.map((row) => row.id));
    if (
      movingIds.has(move.beforeId ?? "") ||
      movingIds.has(move.afterId ?? "")
    ) {
      return;
    }

    onMoveMany({
      workItemIds: moving.map((row) => row.id),
      sprintId: move.sprintId,
      beforeId: move.beforeId,
      afterId: move.afterId,
    });
  }

  const unitLabel = capacityUnit === "points" ? "pts" : "h";

  // Where a ghost parent actually lives, so a context row says so instead of
  // looking like a member of the group it is drawn in.
  const sprintNameById = useMemo(
    () => new Map(sprints.map((sprint) => [sprint.id, sprint.name])),
    [sprints],
  );

  return (
    <ListProvider
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={() => {
        setActiveItem(null);
        activeItemsRef.current = [];
        setActiveItems([]);
        setDropCaption(null);
      }}
      collisionDetection={bandAwareCollision}
      className="gap-3"
      overlay={
        activeItem ? (
          <div className="flex w-[min(20rem,calc(100vw-2rem))] cursor-grabbing flex-col gap-1.5">
            <DragPreview item={activeItem} types={types} />
            {activeItems.length > 1 ? (
              <span className="self-start rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                Moving {activeItems.length} selected items
              </span>
            ) : null}
            {dropCaption ? <DropCaption text={dropCaption} /> : null}
          </div>
        ) : null
      }
    >
      {groups.map((group) => {
        const everything = group.id === ALL_GROUP;
        // A group holding both an epic and its stories counts the epic only —
        // its estimate already covers them (see `sumEstimates`).
        const estimated = sumEstimates(group.items, allItems, estimates);
        const capacity = group.sprint?.plannedCapacity ?? 0;
        const over = group.sprint ? estimated > capacity : false;
        const collapsed = collapsedIds.has(group.id);
        // The disclosure rail only earns its 20px when something in this group
        // can actually fold.
        const hasTree = group.rows.some((row) => row.hasChildren);
        // The sprint column is reserved when something in this group fills it:
        // an ungrouped list (every row names its sprint), or a context row
        // naming where its item really lives. Reserving it otherwise would
        // leave 7rem of dead space down a grouped card.
        const sprintColumn = everything || group.rows.some((row) => row.ghost);

        return (
          <ListGroup
            key={group.id}
            id={group.id}
            className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
          >
            <ListHeader>
              <header
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 py-2 pl-2 pr-3",
                  // The rule under the header only earns its place when there
                  // are rows beneath it to separate.
                  !collapsed && "border-b border-border",
                )}
              >
                {/* The whole identity block is the disclosure: chevron, icon
                    tile, name and meta line all toggle the group. */}
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={!collapsed}
                  className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent"
                >
                  <IconChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      collapsed && "-rotate-90",
                    )}
                  />
                  {/* Neutral chip tile, coloured glyph only — per the DS rule
                      for icon squares outside dense lists. */}
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-md bg-chip"
                  >
                    {group.sprint ? (
                      <IconRocket className="size-4.5 text-brand" />
                    ) : (
                      <IconStack2 className="size-4.5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate font-heading text-[15px] font-semibold tracking-tight">
                        {group.sprint
                          ? group.sprint.name
                          : everything
                            ? "All items"
                            : "Backlog"}
                      </h3>
                      <Pill className="tabular-nums">{group.items.length}</Pill>
                    </span>
                    <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                      {group.sprint ? (
                        <>
                          <IconCalendar className="size-3.5" aria-hidden />
                          {formatIsoShort(group.sprint.startDate)} –{" "}
                          {formatIsoShort(group.sprint.endDate)}
                        </>
                      ) : everything ? (
                        "Every item, ranked by priority"
                      ) : (
                        "Unscheduled, ranked by priority"
                      )}
                    </span>
                  </span>
                </button>
                {group.sprint ? (
                  <SprintStateBadge state={group.sprint.state} />
                ) : null}
                <div className="ml-auto flex items-center gap-3">
                  {group.sprint ? (
                    <CapacityMeter
                      estimated={estimated}
                      capacity={capacity}
                      unitLabel={unitLabel}
                      over={over}
                    />
                  ) : (
                    <span className="text-xs font-semibold tabular-nums text-foreground">
                      {estimated}
                      {unitLabel}{" "}
                      <span className="font-normal text-muted-foreground">
                        estimated
                      </span>
                    </span>
                  )}
                  {canCreate ? (
                    // Opens the panel's inline composer with THIS section's
                    // sprint already picked, rather than navigating to the
                    // create page: adding work to a sprint is a thing you do
                    // while reading the sprint, and the row has to land in the
                    // list you are looking at.
                    <button
                      type="button"
                      onClick={() =>
                        onCompose({
                          sprintId: group.sprint?.id ?? null,
                          statusId: null,
                        })
                      }
                      aria-label={
                        group.sprint
                          ? `New item in ${group.sprint.name}`
                          : "New item"
                      }
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <IconPlus className="size-4" />
                    </button>
                  ) : null}
                </div>
              </header>
            </ListHeader>

            {collapsed ? null : (
              <ListItems className="gap-0 p-0">
                {group.rows.map((row, index) => {
                  // Which subtrees close in the seam BELOW this row: every
                  // ancestor of it that the next row is no longer inside. Those
                  // are exactly the levels whose end no row can express.
                  const isLast = index === group.rows.length - 1;
                  const nextDepth = group.rows[index + 1]?.depth ?? 0;
                  const scope = rowsByGroup.get(group.id);
                  const closing: TreeRow[] = [];
                  if (activeItem !== null && nested && canNest && scope) {
                    let cursor = row.parentId
                      ? scope.get(row.parentId)
                      : undefined;
                    while (cursor && (isLast || cursor.depth >= nextDepth)) {
                      // A level the dragged item may not join is not offered.
                      if (
                        canNestUnder({
                          child: activeItem,
                          parent: cursor.item,
                          types,
                          byId,
                        })
                      ) {
                        closing.push(cursor);
                      }
                      cursor = cursor.parentId
                        ? scope.get(cursor.parentId)
                        : undefined;
                    }
                  }
                  const endZones =
                    activeItem !== null && nested && canNest ? (
                      <SubtreeEndZones
                        groupId={group.id}
                        parents={closing}
                        includeTopLevel={isLast}
                      />
                    ) : null;

                  return (
                    <Fragment key={row.item.id}>
                      {row.ghost ? (
                        <GhostRow
                          row={row}
                          groupId={group.id}
                          renderMenu={(element) => (
                            <ItemMenu context={menu} item={row.item}>
                              {element}
                            </ItemMenu>
                          )}
                          types={types}
                          unitLabel={unitLabel}
                          showRail={nested && hasTree}
                          dragging={activeItem}
                          nestable={
                            canNest &&
                            nested &&
                            activeItem !== null &&
                            canNestUnder({
                              child: activeItem,
                              parent: row.item,
                              types,
                              byId,
                            })
                          }
                          location={
                            // Same section, so it isn't placement that put it out
                            // of the list — a filter did.
                            (row.item.sprintId ?? null) ===
                            (group.sprint?.id ?? null)
                              ? "Hidden by filter"
                              : row.item.sprintId
                                ? (sprintNameById.get(row.item.sprintId) ??
                                  "Another sprint")
                                : "Backlog"
                          }
                          onToggleFold={toggleFold}
                          onOpen={onOpen}
                        />
                      ) : (
                        <BacklogRow
                          row={row}
                          index={index}
                          parent={group.id}
                          selection={menu.selection}
                          selectableIds={selectableIds}
                          renderMenu={(element) => (
                            <ItemMenu
                              context={menu}
                              item={row.item}
                              canUnnest={
                                canNest &&
                                (row.depth > 0 || row.detachedParent !== null)
                              }
                              onUnnest={onUnnest}
                            >
                              {element}
                            </ItemMenu>
                          )}
                          statuses={statuses}
                          types={types}
                          unitLabel={unitLabel}
                          showRail={nested && hasTree}
                          sprintColumn={sprintColumn}
                          // Ungrouped, the card header no longer says which sprint
                          // this is — the row has to carry it itself.
                          sprintLabel={
                            everything && row.item.sprintId
                              ? (sprintNameById.get(row.item.sprintId) ??
                                "Sprint")
                              : null
                          }
                          dragging={activeItem}
                          nestable={
                            canNest &&
                            nested &&
                            activeItem !== null &&
                            canNestUnder({
                              child: activeItem,
                              parent: row.item,
                              types,
                              byId,
                            })
                          }
                          canUnnest={canNest}
                          onToggleFold={toggleFold}
                          onOpen={onOpen}
                          onUnnest={onUnnest}
                        />
                      )}
                      {endZones}
                    </Fragment>
                  );
                })}
                {group.rows.length === 0 ? (
                  // One thin dashed line rather than a paragraph in a 100px
                  // void — an empty sprint is a drop target, not an essay.
                  <p className="m-2 rounded-md border border-dashed border-border py-2 text-center text-xs text-muted-foreground">
                    {group.sprint
                      ? "Drag items here to plan this sprint."
                      : everything
                        ? "Nothing to show."
                        : "Nothing unplanned — everything is in a sprint."}
                  </p>
                ) : null}
              </ListItems>
            )}
          </ListGroup>
        );
      })}
    </ListProvider>
  );
}

/**
 * Sprint load at a glance: the bar answers "is this sprint full?" before the
 * numbers do. Over capacity keeps the number AND flips the bar to warning, so
 * the signal survives colour-vision deficiency.
 */
function CapacityMeter({
  estimated,
  capacity,
  unitLabel,
  over,
}: {
  estimated: number;
  capacity: number;
  unitLabel: string;
  over: boolean;
}) {
  const filled = capacity > 0 ? Math.min(estimated / capacity, 1) * 100 : 0;
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width]",
            over ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${over ? 100 : filled}%` }}
        />
      </span>
      <span
        className={cn(
          "text-xs font-semibold tabular-nums",
          over ? "text-warning" : "text-foreground",
        )}
      >
        {estimated}
        {unitLabel} / {capacity}
        {unitLabel}
        {over ? " · over" : ""}
      </span>
    </span>
  );
}

function BacklogRow({
  row,
  index,
  parent,
  statuses,
  types,
  unitLabel,
  showRail,
  sprintColumn,
  sprintLabel,
  dragging,
  nestable,
  canUnnest,
  selection,
  selectableIds,
  onToggleFold,
  onOpen,
  onUnnest,
  renderMenu,
}: {
  row: TreeRow;
  index: number;
  parent: string;
  statuses: WorkflowStatusRow[];
  types: WorkItemTypeRow[];
  unitLabel: string;
  showRail: boolean;
  /** Whether the metadata rail keeps a sprint/context column at all. */
  sprintColumn: boolean;
  /** Which sprint this row sits in — only set when the list isn't grouped. */
  sprintLabel: string | null;
  dragging: WorkItemRow | null;
  nestable: boolean;
  canUnnest: boolean;
  selection: ItemSelection;
  /** Every selectable row in draw order — what a shift-range spans. */
  selectableIds: string[];
  onToggleFold: (itemId: string) => void;
  onOpen: (item: WorkItemRow) => void;
  onUnnest: (item: WorkItemRow) => void;
  renderMenu: (element: ReactElement) => ReactElement;
}) {
  const { item, depth } = row;
  // The per-row drop target Kibo's List doesn't ship, kept as the fallback for
  // a pointer that is inside the row but outside every band.
  const { setNodeRef, isOver } = useDroppable({
    id: bandId(ITEM_PREFIX, parent, item.id),
  });

  // Bands only exist while something is in the air — a row is not a drop zone
  // when nothing is being dropped.
  const showBands = dragging !== null && dragging.id !== item.id;
  const selected = selection.ids.has(item.id);

  const element = (
    <div
      ref={setNodeRef}
      className={cn(
        // Rows are ON the card, divided by hairlines — not grey slabs floating
        // inside it. The old per-row `bg-background` was the content CANVAS
        // colour, which read as a sunken tile and washed the whole list out.
        "group/row relative border-b border-border last:border-b-0",
        // A selected row is a filled violet-tint block, per the DS rule that
        // selection is a fill and never an edge.
        selected && "bg-secondary",
        // ring-inset, because rows now run edge to edge inside a card with
        // overflow-hidden — an outward ring would be clipped on both sides.
        isOver && "ring-2 ring-primary/40 ring-inset",
      )}
    >
      <ListItem
        id={item.id}
        name={item.summary}
        index={index}
        parent={parent}
        handle
        className={cn(
          "gap-2.5 rounded-none border-0 bg-transparent px-3 py-2.5 shadow-none transition-colors hover:bg-accent",
          selected && "hover:bg-secondary",
        )}
      >
        {/* A row carries a tick box, a fold chevron, a title button and a
            handful of chips — dragging from "anywhere that isn't one of those"
            was a guess every time, and the guess that missed selected the row
            or opened the item. The grip is the only activator now. */}
        <ListItemDragHandle label={`Reorder ${item.key}`} />
        <SelectBox
          item={item}
          selection={selection}
          orderedIds={selectableIds}
        />
        {depth > 0 ? (
          // One guide line at the row's own level: enough to read the nesting,
          // without a ladder of rules down the whole card.
          <span
            aria-hidden
            className="shrink-0 self-stretch border-l border-border"
            style={{ marginLeft: (depth - 1) * INDENT + 4 }}
          />
        ) : null}
        {row.hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleFold(item.id)}
            aria-expanded={!row.collapsed}
            aria-label={`${row.collapsed ? "Show" : "Hide"} children of ${item.key}`}
            className="-my-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                row.collapsed && "-rotate-90",
              )}
            />
          </button>
        ) : showRail ? (
          // Keeps every key in one column whether or not the row folds.
          <span aria-hidden className="size-6 shrink-0" />
        ) : null}
        <RowCells
          item={item}
          statuses={statuses}
          types={types}
          rollup={row.rollup}
          detachedParent={row.detachedParent}
          sprintColumn={sprintColumn}
          sprintLabel={sprintLabel}
          unitLabel={unitLabel}
          canUnnest={canUnnest && (depth > 0 || row.detachedParent !== null)}
          onOpen={onOpen}
          onUnnest={onUnnest}
        />
      </ListItem>

      {showBands ? (
        <RowDropBands
          groupId={parent}
          item={item}
          depth={depth}
          nestable={nestable}
        />
      ) : null}
    </div>
  );

  return renderMenu(element);
}

/**
 * A parent that isn't in this group, drawn so the children that ARE keep their
 * hierarchy here. Deliberately NOT the draggable/droppable row: the same item
 * can be a ghost in several groups at once, and two dnd-kit nodes sharing an id
 * would fight over every drop. It reads as context — muted, no status, no
 * assignee, no estimate — with a chip naming where the item really lives.
 */
function GhostRow({
  row,
  groupId,
  types,
  unitLabel,
  showRail,
  location,
  dragging,
  nestable,
  onToggleFold,
  onOpen,
  renderMenu,
}: {
  row: TreeRow;
  /** Which card this context row is drawn in — namespaces its drop bands. */
  groupId: string;
  types: WorkItemTypeRow[];
  unitLabel: string;
  showRail: boolean;
  location: string;
  dragging: WorkItemRow | null;
  nestable: boolean;
  onToggleFold: (itemId: string) => void;
  onOpen: (item: WorkItemRow) => void;
  renderMenu: (element: ReactElement) => ReactElement;
}) {
  const { item, depth } = row;
  // Inert as a DRAG source — this row's item lives in another card, so picking
  // it up here would be ambiguous — but a perfectly good drop TARGET: the
  // position beside it is a real position, and it is a real parent.
  const showBands = dragging !== null && dragging.id !== item.id;

  const element = (
    <div className="relative border-b border-border bg-muted/40 last:border-b-0">
      <div className="flex items-center gap-2.5 px-3 py-2">
        {/* No tick box: this item's real row lives in another card, and
            selecting it in both would send it twice. The slot is still held so
            the keys line up with the rows above and below. */}
        <span aria-hidden className="size-4 shrink-0" />
        {depth > 0 ? (
          <span
            aria-hidden
            className="shrink-0 self-stretch border-l border-border"
            style={{ marginLeft: (depth - 1) * INDENT + 4 }}
          />
        ) : null}
        {row.hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleFold(item.id)}
            aria-expanded={!row.collapsed}
            aria-label={`${row.collapsed ? "Show" : "Hide"} children of ${item.key}`}
            className="-my-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                row.collapsed && "-rotate-90",
              )}
            />
          </button>
        ) : showRail ? (
          <span aria-hidden className="size-6 shrink-0" />
        ) : null}
        <ItemRowIcons item={item} types={types} />
        <button
          type="button"
          onClick={() => onOpen(item)}
          aria-label={`Open ${item.key}`}
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium text-muted-foreground hover:underline"
        >
          {item.summary}
        </button>
        {/* The same rail as a real row, so a context row's chips sit in the
            same columns instead of floating wherever its title ended. */}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <MetaCell className={cn("hidden md:flex", META.rollup)}>
            {row.rollup ? (
              <RollupChip rollup={row.rollup} unitLabel={unitLabel} />
            ) : null}
          </MetaCell>
          <MetaCell className={META.sprint}>
            {/* Colour is never the only signal, so the placement is spelled out. */}
            <span
              title={`Parent of the items below, shown for context · ${location}`}
              className="flex min-w-0 items-center gap-1 rounded-sm bg-chip px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
            >
              <span className="sr-only">Parent shown for context, in </span>
              {item.sprintId ? (
                <IconRocket className="size-3 shrink-0" aria-hidden />
              ) : (
                <IconStack2 className="size-3 shrink-0" aria-hidden />
              )}
              <span className="truncate">{location}</span>
            </span>
          </MetaCell>
          <MetaCell className={cn("hidden xl:flex", META.labels)} />
          <MetaCell className={cn("hidden lg:flex", META.due)} />
          <MetaCell className={cn("hidden sm:flex", META.status)} />
          <MetaCell className={cn("hidden sm:flex", META.points)} />
          <MetaCell className={META.avatar} />
        </span>
      </div>

      {showBands ? (
        <RowDropBands
          groupId={groupId}
          item={item}
          depth={depth}
          nestable={nestable}
        />
      ) : null}
    </div>
  );

  return renderMenu(element);
}

/**
 * The "append at the end of this level" targets, drawn in the seam where one or
 * more subtrees CLOSE — that is, wherever the indentation steps back out.
 *
 * They sit inline, indented to the level they add to, so each one reads as
 * belonging to the item whose children it extends rather than as a block bolted
 * to the bottom of the card. Deepest first, which is the order the subtrees
 * actually close in.
 *
 * Only the levels between the two rows either side of the seam need this: the
 * innermost is the row above's own `after` band and the outermost is the row
 * below's `before` band. The card's LAST seam also offers top level, since
 * nothing follows it to hang that off.
 */
function SubtreeEndZones({
  groupId,
  parents,
  includeTopLevel,
}: {
  groupId: string;
  /** Deepest first — the item whose children each zone would extend. */
  parents: TreeRow[];
  includeTopLevel: boolean;
}) {
  if (parents.length === 0 && !includeTopLevel) return null;

  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      {parents.map((parent) => (
        <EndOfLevelZone
          key={parent.item.id}
          id={bandId(SEAM_PREFIX, groupId, parent.item.id)}
          indent={(parent.depth + 1) * INDENT}
          label={`Add under ${parent.item.key}`}
        />
      ))}
      {includeTopLevel ? (
        <EndOfLevelZone
          id={bandId(SEAM_PREFIX, groupId, "")}
          indent={0}
          label="Add at top level"
        />
      ) : null}
    </div>
  );
}

function EndOfLevelZone({
  id,
  indent,
  label,
}: {
  id: string;
  indent: number;
  label: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div style={{ marginLeft: indent }}>
      <div
        ref={setNodeRef}
        aria-hidden
        className={cn(
          "flex items-center rounded-md border border-dashed px-2 py-1 text-[10px] font-semibold transition-colors",
          isOver
            ? "border-primary bg-secondary text-secondary-foreground"
            : "border-border/70 text-muted-foreground",
        )}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * The three drop bands a row exposes while something is in the air: place
 * above, nest under, place below.
 *
 * Shared by real rows AND context rows. A context row (a parent whose own home
 * is another sprint, drawn here so its children keep their hierarchy) used to
 * ship inert, which left half of a grouped card undroppable — you could not
 * place anything above it, below it, or under it, even though it is a perfectly
 * good parent and the position beside it is a real position. Ids are namespaced
 * by group (see `bandId`), so the same item appearing in several cards no
 * longer registers colliding droppables.
 */
function RowDropBands({
  groupId,
  item,
  depth,
  nestable,
}: {
  groupId: string;
  item: WorkItemRow;
  depth: number;
  nestable: boolean;
}) {
  return (
    <>
      {/* Equal thirds keep sibling placement and nesting equally reachable. */}
      <DropBand
        id={bandId(BEFORE_PREFIX, groupId, item.id)}
        className={nestable ? "top-0 h-1/3" : "top-0 h-1/2"}
        edge="top"
        indent={depth}
      />
      {nestable ? (
        <DropBand
          id={bandId(NEST_PREFIX, groupId, item.id)}
          className="top-1/3 h-1/3"
          edge="nest"
          indent={depth + 1}
          parentKey={item.key}
        />
      ) : null}
      <DropBand
        id={bandId(AFTER_PREFIX, groupId, item.id)}
        className={nestable ? "bottom-0 h-1/3" : "bottom-0 h-1/2"}
        edge="bottom"
        indent={depth}
      />
    </>
  );
}

/**
 * A slice of a row, as a drop target. `pointer-events-none` throughout —
 * dnd-kit resolves drops from measured rects and the pointer position, not from
 * DOM hit-testing, so the bands never steal a click from the row beneath them.
 *
 * The cue intentionally marks only the destination. The former full-width
 * duplicate row made the list appear to jump underneath the pointer and hid
 * the item being targeted.
 */
function DropBand({
  id,
  className,
  edge,
  indent,
  parentKey,
}: {
  id: string;
  className: string;
  edge: "top" | "bottom" | "nest";
  /** The resulting tree depth, used to align an insertion cue with its row. */
  indent: number;
  /** Present only for the child target, so the parent is never ambiguous. */
  parentKey?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0", className)}
    >
      {edge === "nest" ? (
        // Nesting is deliberately quiet until targeted. On target, the whole
        // centre lane becomes a small, indented child destination rather than
        // another generic selected row.
        <span
          className={cn(
            "absolute inset-x-1 inset-y-0.5 rounded-md transition-colors",
            isOver
              ? "bg-secondary/80 ring-1 ring-primary/45 ring-inset"
              : "bg-transparent",
          )}
        />
      ) : null}
      {isOver && edge !== "nest" ? (
        <span
          className={cn(
            "absolute right-2 flex items-center",
            edge === "top"
              ? "top-0 -translate-y-px"
              : "bottom-0 translate-y-px",
          )}
          style={{ left: indent * INDENT + 10 }}
        >
          <span className="size-2 shrink-0 rounded-full border-2 border-card bg-primary" />
          <span className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_18%,transparent)]" />
        </span>
      ) : null}
      {isOver && edge === "nest" ? (
        <>
          {/* The short vertical rail and elbow mirror the tree drawn below the
              parent. They make the resulting depth legible before release. */}
          <span
            aria-hidden
            className="absolute bottom-0 top-1/2 w-0.5 rounded-full bg-primary"
            style={{ left: indent * INDENT + 16 }}
          />
          <span
            aria-hidden
            className="absolute top-1/2 h-2 w-2 rounded-bl border-b-2 border-l-2 border-primary"
            style={{ left: indent * INDENT + 16 }}
          />
          <span
            className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground shadow-card"
            style={{ marginLeft: indent * INDENT + 28 }}
          >
            <IconCornerDownRight aria-hidden className="size-3" />
            Nest under {parentKey}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * The pending drop, in words, pinned under the drag preview.
 *
 * The bands are thirds of a ~44px row — about 14px each — so "which third am I
 * in" is not something a highlight inside one of them can answer on its own.
 * This says it outright ("Nest under PROJ-4", "Place above PROJ-7 · at top
 * level") and travels with the cursor, which is what makes the gesture
 * learnable rather than a thing you retry until it sticks.
 */
function DropCaption({ text }: { text: string }) {
  return (
    <span className="w-fit rounded-sm bg-foreground px-2 py-1 text-[11px] font-semibold text-background shadow-float">
      {text}
    </span>
  );
}

/** A deliberately compact carry-card: the list stays visible while dragging. */
function DragPreview({
  item,
  types,
}: {
  item: WorkItemRow;
  types: WorkItemTypeRow[];
}) {
  const type = typeById(types, item.typeId);

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--r-ctrl)] border border-primary/30 bg-card px-3 py-2 shadow-float ring-1 ring-primary/15">
      <WorkItemTypeIcon type={type} />
      <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
        {item.key}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {item.summary}
      </span>
    </div>
  );
}

/**
 * The row's content, shared between the in-list row and the DragOverlay
 * preview so the floating copy is pixel-identical to what was picked up.
 */
function RowCells({
  item,
  statuses,
  types,
  rollup = null,
  detachedParent = null,
  sprintColumn = false,
  sprintLabel = null,
  unitLabel = "h",
  canUnnest = false,
  onOpen,
  onUnnest,
}: {
  item: WorkItemRow;
  statuses: WorkflowStatusRow[];
  types: WorkItemTypeRow[];
  rollup?: TreeRow["rollup"];
  detachedParent?: WorkItemRow | null;
  /** Whether the rail reserves a sprint slot at all — see `META`. */
  sprintColumn?: boolean;
  sprintLabel?: string | null;
  unitLabel?: string;
  canUnnest?: boolean;
  onOpen: (item: WorkItemRow) => void;
  onUnnest?: (item: WorkItemRow) => void;
}) {
  const status = statuses.find((row) => row.id === item.statusId);
  const estimate = useItemEstimate(item);

  return (
    <>
      <ItemRowIcons item={item} types={types} />
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`Open ${item.key}`}
        className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium hover:underline"
      >
        {item.summary}
      </button>
      {detachedParent ? (
        // The parent exists but isn't the row above — it sits in another sprint
        // or a filter hid it. Say so rather than render this as a root.
        <span
          title={`Child of ${detachedParent.key} — ${detachedParent.summary}`}
          className="hidden shrink-0 items-center gap-0.5 rounded-sm bg-chip px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground lg:flex"
        >
          <IconCornerDownRight className="size-3" aria-hidden />
          {detachedParent.key}
        </span>
      ) : null}
      {canUnnest && onUnnest ? (
        <button
          type="button"
          onClick={() => onUnnest(item)}
          title="Detach from parent"
          aria-label={`Detach ${item.key} from its parent`}
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <IconUnlink className="size-3.5" aria-hidden />
        </button>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <MetaCell className={cn("hidden md:flex", META.rollup)}>
          {rollup ? <RollupChip rollup={rollup} unitLabel={unitLabel} /> : null}
        </MetaCell>
        {sprintColumn ? (
          <MetaCell className={cn("hidden md:flex", META.sprint)}>
            {sprintLabel ? (
              // Sprint membership as a property of the row, which is what lets
              // the list stay one ranked pile instead of one card per sprint.
              <span
                title={`In ${sprintLabel}`}
                className="flex min-w-0 items-center gap-1 rounded-sm bg-chip px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
              >
                <IconRocket className="size-3 shrink-0" aria-hidden />
                <span className="sr-only">In sprint </span>
                <span className="truncate">{sprintLabel}</span>
              </span>
            ) : null}
          </MetaCell>
        ) : null}
        <MetaCell
          className={cn("hidden gap-1 overflow-hidden xl:flex", META.labels)}
        >
          {/* Room-permitting context, never load-bearing: wide screens see the
              first two labels, everyone else finds them on the item page. */}
          {item.labels.slice(0, 2).map((label) => (
            <span
              key={label}
              className="min-w-0 truncate rounded-sm bg-chip px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
            >
              {label}
            </span>
          ))}
        </MetaCell>
        <MetaCell
          className={cn(
            "hidden gap-1 text-[11px] tabular-nums text-muted-foreground lg:flex",
            META.due,
          )}
        >
          {item.dueDate ? (
            <>
              <IconCalendar className="size-3.5 shrink-0" aria-hidden />
              {formatIsoShort(item.dueDate)}
            </>
          ) : null}
        </MetaCell>
        <MetaCell className={cn("hidden sm:flex", META.status)}>
          {status ? (
            <StatusChip name={status.name} category={status.category} />
          ) : null}
        </MetaCell>
        <MetaCell className={cn("hidden sm:flex", META.points)}>
          {estimate.value !== null ? (
            // A rolled-up number is stated in muted weight and names its source
            // in the tooltip: it is a fact about the children, not something
            // anyone typed on this row.
            <span
              title={describeEstimate(estimate, unitLabel)}
              className={cn(
                "rounded-sm bg-chip px-1.5 py-0.5 text-[11px] tabular-nums",
                estimate.source === "own"
                  ? "font-bold text-foreground"
                  : "font-semibold text-muted-foreground",
              )}
            >
              {estimate.value}
            </span>
          ) : null}
        </MetaCell>
        <MetaCell className={META.avatar}>
          {item.assigneeName ? (
            // Hover-only, like the board card: the row is already one link, and
            // a focusable trigger per row would double the tab stops here.
            <UserGlimpse
              interactive={false}
              seed={{
                memberId: item.assigneeMemberId,
                name: item.assigneeName,
                image: item.assigneeImage,
              }}
            >
              <Avatar className="size-6">
                {item.assigneeImage ? (
                  <AvatarImage src={item.assigneeImage} alt="" />
                ) : null}
                <AvatarFallback className="text-[10px]">
                  {initialsOf(item.assigneeName)}
                </AvatarFallback>
              </Avatar>
            </UserGlimpse>
          ) : (
            // A dashed ring reads as "this slot is empty" at a glance, where
            // the old grey word only read as more grey text.
            <span
              title="Unassigned"
              className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-[10px] font-bold text-muted-foreground"
            >
              <IconUser className="size-3.5" aria-hidden />
              <span className="sr-only">Unassigned</span>
            </span>
          )}
        </MetaCell>
      </span>
    </>
  );
}

/**
 * What a parent is carrying: descendants delivered out of descendants total,
 * plus their summed estimate. The bar is the glance, the fraction is the fact —
 * colour is never the only signal.
 */
function RollupChip({
  rollup,
  unitLabel,
}: {
  rollup: NonNullable<TreeRow["rollup"]>;
  unitLabel: string;
}) {
  const filled = rollup.total > 0 ? (rollup.done / rollup.total) * 100 : 0;
  const label = `${rollup.done} of ${rollup.total} child item${
    rollup.total === 1 ? "" : "s"
  } done${rollup.points > 0 ? `, ${rollup.points}${unitLabel} estimated` : ""}`;

  return (
    <span title={label} className="flex shrink-0 items-center gap-1.5">
      <span
        aria-hidden
        className="h-1.5 w-10 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full rounded-full bg-success transition-[width]"
          style={{ width: `${filled}%` }}
        />
      </span>
      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
        {rollup.done}/{rollup.total}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
