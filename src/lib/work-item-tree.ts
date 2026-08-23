import type { WorkItemRow, WorkItemTypeRow } from "@/lib/actions/work-items";
import { effectiveEstimates } from "@/lib/estimate-rollup";
import { canParent } from "@/lib/work-items";

/**
 * Parent/child arithmetic for the backlog list, kept out of the view so the
 * rules that decide what may nest under what live in one readable place.
 *
 * The contract is `workItemType.hierarchyLevel`: a lower number is higher in
 * the tree. It is gated by the CHILD type's `strictHierarchy`: a strict type
 * needs a strictly higher parent, a non-strict one goes anywhere. Everything
 * here re-states that rule client-side so a drop
 * that the server would refuse never starts; the server check in
 * `setWorkItemParent` is still the authority.
 */

/** Descendant aggregates for one parent — the row's roll-up chip. */
export type WorkItemRollup = {
  /** Descendants at every depth, not just direct children. */
  total: number;
  done: number;
  points: number;
};

/** One rendered line of the nested list: an item plus where it sits. */
export type TreeRow = {
  item: WorkItemRow;
  /** Indent level. 0 is a row with no parent rendered above it. */
  depth: number;
  /** The parent RENDERED above this row, or null at top level. */
  parentId: string | null;
  /**
   * This row's RANKABLE siblings under that parent, in rank order. Ghosts are
   * excluded — they live in another group, so ranking against one would compute
   * a rank from a row the user cannot see — which means a ghost row's own array
   * does NOT contain the ghost itself. Use `rankIndex` to place against it.
   */
  siblings: WorkItemRow[];
  /**
   * Where this row sits in `siblings`, counting only rankable rows before it.
   *
   * For a real row that is simply its index. For a GHOST it is the insertion
   * point — the gap between the rankable siblings either side of it — which is
   * the only way to express "drop here" against a row that holds no rank. A
   * drop next to a ghost used to fail the `indexOf(target)` lookup and return
   * silently, so in a grouped card, where the only top-level rows are often
   * ghosts, nothing could be dropped at root level at all.
   */
  rankIndex: number;
  hasChildren: boolean;
  /** True only when children exist AND are folded away. */
  collapsed: boolean;
  /**
   * A CONTEXT row: the item does NOT belong to the group it is rendered in —
   * it is drawn only so the children that do belong have their parent above
   * them. Ghost rows are inert: not draggable, not a drop target, and never
   * counted in the group's totals.
   */
  ghost: boolean;
  /**
   * The item's real parent when it is NOT the row above — the parent sits in
   * another sprint group, or a filter hid it. The row renders at top level with
   * a hint instead of pretending it is unparented.
   *
   * With ghost parents this is only reached when the parent is missing from
   * `allItems` altogether, so there is nothing to draw a ghost from.
   */
  detachedParent: WorkItemRow | null;
  /** Present only when the item has descendants anywhere in the project. */
  rollup: WorkItemRollup | null;
};

/** Hierarchy level of an item's type; unknown types sort as Standard. */
export function levelOfItem(
  item: WorkItemRow,
  types: WorkItemTypeRow[],
): number {
  return types.find((type) => type.id === item.typeId)?.hierarchyLevel ?? 2;
}

/**
 * Does this item's type hold itself to the level rule? An unknown type is
 * treated as strict — refusing a nest is recoverable, silently allowing one the
 * catalog forbids is not.
 */
export function isStrictItem(
  item: WorkItemRow,
  types: WorkItemTypeRow[],
): boolean {
  return types.find((type) => type.id === item.typeId)?.strictHierarchy ?? true;
}

/** Walks `candidate`'s parent chain looking for `ancestorId`. */
export function isDescendantOf(
  byId: Map<string, WorkItemRow>,
  candidateId: string,
  ancestorId: string,
): boolean {
  const seen = new Set<string>();
  let current = byId.get(candidateId)?.parentId ?? null;
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false; // data cycle — refuse rather than spin
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * May `child` be re-parented under `parent`? Level rule, no self-parenting, no
 * cycles — and "already there" counts as no, so the UI doesn't offer a drop
 * that would be a no-op.
 *
 * The level rule is the CHILD type's to keep: a type with `strictHierarchy` off
 * nests anywhere, which is what lets the level-1 trio (Story/Task/Bug) hold one
 * another. Self and cycle checks are unconditional.
 */
export function canNestUnder({
  child,
  parent,
  types,
  byId,
}: {
  child: WorkItemRow;
  parent: WorkItemRow;
  types: WorkItemTypeRow[];
  byId: Map<string, WorkItemRow>;
}): boolean {
  if (child.id === parent.id) return false;
  if (child.parentId === parent.id) return false;
  if (
    !canParent(
      levelOfItem(parent, types),
      levelOfItem(child, types),
      isStrictItem(child, types),
    )
  ) {
    return false;
  }
  return !isDescendantOf(byId, parent.id, child.id);
}

/**
 * Descendant totals for every item that has any, in one pass over the project.
 * Computed from ALL items rather than the filtered list on purpose: "8 items,
 * 3 done" has to stay true when a filter is hiding half of them.
 */
export function rollupsOf(
  allItems: WorkItemRow[],
  isDone: (item: WorkItemRow) => boolean,
): Map<string, WorkItemRollup> {
  // The chip's estimate is the DERIVED one, so a parent's chip and its Estimate
  // cell can never disagree: a child that was sized directly counts for what it
  // says, and a child that is itself a parent counts for what its own children
  // add up to (see `effectiveEstimates`).
  const estimates = effectiveEstimates(allItems);
  const childrenOf = new Map<string, WorkItemRow[]>();
  for (const item of allItems) {
    if (!item.parentId) continue;
    const bucket = childrenOf.get(item.parentId);
    if (bucket) bucket.push(item);
    else childrenOf.set(item.parentId, [item]);
  }

  const memo = new Map<string, WorkItemRollup>();
  const visiting = new Set<string>();

  function compute(id: string): WorkItemRollup {
    const cached = memo.get(id);
    if (cached) return cached;
    // A cycle can only come from corrupt data, but a recursive walk is not the
    // place to find out — bail with zeroes rather than blowing the stack.
    if (visiting.has(id)) return { total: 0, done: 0, points: 0 };
    visiting.add(id);

    let total = 0;
    let done = 0;
    let points = 0;
    for (const child of childrenOf.get(id) ?? []) {
      const sub = compute(child.id);
      total += 1 + sub.total;
      done += (isDone(child) ? 1 : 0) + sub.done;
      // Direct children only: a child's own effective estimate already carries
      // whatever is broken out beneath it, so descending again would double it.
      points += estimates.get(child.id)?.value ?? 0;
    }

    visiting.delete(id);
    const rollup = { total, done, points };
    memo.set(id, rollup);
    return rollup;
  }

  const out = new Map<string, WorkItemRollup>();
  for (const item of allItems) {
    const rollup = compute(item.id);
    if (rollup.total > 0) out.set(item.id, rollup);
  }
  return out;
}

/**
 * Flattens one group's items into rendered lines, depth-first.
 *
 * A flat array rather than nested containers: every row stays a sibling in the
 * DOM, which keeps the drag list and its per-row drop targets simple — the
 * indent is padding, not structure.
 *
 * A child whose parent is NOT in this group (the epic sits in another sprint,
 * or is unscheduled) still renders under it: the parent chain is materialized
 * as GHOST rows — context only, never draggable, never a drop target, never
 * counted. Without them a sprint reads as a flat pile of stories whose epics
 * are a chip you have to decode; with them the same hierarchy shows up in every
 * group the work landed in. `detachedParent` survives for the one case a ghost
 * can't cover: a parent id that isn't in `allItems` at all.
 */
export function buildTreeRows({
  items,
  allItems,
  rollups,
  collapsed,
  ghostParents = true,
}: {
  /** The group's items, already filtered and rank-ordered. */
  items: WorkItemRow[];
  /** Every item in the project — the ghost chain is read from here, so it is
   *  drawn even when a filter hid the parent. */
  allItems: WorkItemRow[];
  rollups: Map<string, WorkItemRollup>;
  collapsed: ReadonlySet<string>;
  /** Off renders out-of-group children at top level with `detachedParent`. */
  ghostParents?: boolean;
}): TreeRow[] {
  const inGroup = new Map(items.map((item) => [item.id, item]));
  const byId = new Map(allItems.map((item) => [item.id, item]));

  const childrenOf = new Map<string, WorkItemRow[]>();
  const roots: WorkItemRow[] = [];
  const ghosts = new Set<string>();

  function addChild(parentId: string, child: WorkItemRow) {
    const bucket = childrenOf.get(parentId);
    if (bucket) bucket.push(child);
    else childrenOf.set(parentId, [child]);
  }

  /**
   * The ancestors between `item` and the group, nearest first. `anchor` is the
   * first ancestor that IS in the group — the chain hangs off it instead of
   * off the top level, so a sub-task whose story is elsewhere but whose epic is
   * right here still lands inside that epic.
   */
  function ancestorChain(item: WorkItemRow): {
    chain: WorkItemRow[];
    anchor: WorkItemRow | null;
  } {
    const chain: WorkItemRow[] = [];
    const seen = new Set<string>([item.id]);
    let current = item;
    // Bounded by `seen`: corrupt data must not spin here.
    while (current.parentId && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (!parent) break; // unknown parent — nothing to draw, hint instead
      if (inGroup.has(parent.id)) return { chain, anchor: parent };
      chain.push(parent);
      current = parent;
    }
    return { chain, anchor: null };
  }

  for (const item of items) {
    const parentId = item.parentId;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    if (inGroup.has(parentId)) {
      addChild(parentId, item);
      continue;
    }
    if (!ghostParents) {
      roots.push(item);
      continue;
    }

    const { chain, anchor } = ancestorChain(item);
    if (chain.length === 0) {
      roots.push(item); // parent isn't in the project data — `detachedParent`
      continue;
    }

    addChild(chain[0].id, item);
    // Link the chain upward, stopping at the first ghost already wired up —
    // several children of the same out-of-group epic share one ghost row.
    for (let index = 0; index < chain.length; index += 1) {
      const ghost = chain[index];
      if (ghosts.has(ghost.id)) break;
      ghosts.add(ghost.id);
      const above = chain[index + 1];
      if (above) addChild(above.id, ghost);
      else if (anchor) addChild(anchor.id, ghost);
      else roots.push(ghost);
    }
  }

  const rows: TreeRow[] = [];
  const seen = new Set<string>();

  function walk(
    siblings: WorkItemRow[],
    depth: number,
    parentId: string | null,
  ) {
    // Ghosts are never ranking neighbours: they live in another group, so a
    // drop that took one as its `beforeId` would compute a rank from a row the
    // user isn't even looking at. Every row in this sibling set sees the same
    // filtered array, computed once.
    const rankable = siblings.some((row) => ghosts.has(row.id))
      ? siblings.filter((row) => !ghosts.has(row.id))
      : siblings;

    // Counts only the rankable rows already emitted at this level, so a ghost
    // reports the gap it sits in rather than a position it doesn't hold.
    let rankIndex = 0;

    for (const item of siblings) {
      if (seen.has(item.id)) continue; // cycle guard, same reason as above
      seen.add(item.id);

      const children = childrenOf.get(item.id) ?? [];
      const folded = collapsed.has(item.id);
      const ghost = ghosts.has(item.id);
      rows.push({
        item,
        depth,
        parentId,
        siblings: rankable,
        rankIndex,
        hasChildren: children.length > 0,
        collapsed: folded && children.length > 0,
        ghost,
        detachedParent:
          !ghost && parentId === null && item.parentId
            ? (byId.get(item.parentId) ?? null)
            : null,
        rollup: rollups.get(item.id) ?? null,
      });

      if (!ghost) rankIndex += 1;

      if (children.length > 0 && !folded) walk(children, depth + 1, item.id);
    }
  }

  walk(roots, 0, null);
  return rows;
}

/**
 * Where a "drop between rows" actually lands.
 *
 * Dropping next to a row means becoming its sibling, which means adopting its
 * parent — and that parent may be illegal for what's being dragged (a Story
 * dropped between two Sub-tasks can't join them under a Story). Rather than
 * refusing the drop, walk up until the level rule holds: the Story becomes a
 * sibling of the Sub-tasks' parent instead. Reaching the top means top level.
 */
export function resolveSiblingRow({
  neighbour,
  item,
  rowsById,
  types,
  byId,
}: {
  neighbour: TreeRow;
  item: WorkItemRow;
  rowsById: Map<string, TreeRow>;
  types: WorkItemTypeRow[];
  byId: Map<string, WorkItemRow>;
}): TreeRow {
  let current = neighbour;
  const seen = new Set<string>([current.item.id]);
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (
      parent &&
      parent.id !== item.id &&
      canParent(
        levelOfItem(parent, types),
        levelOfItem(item, types),
        isStrictItem(item, types),
      ) &&
      !isDescendantOf(byId, parent.id, item.id)
    ) {
      return current;
    }
    const next = rowsById.get(current.parentId);
    if (!next || seen.has(next.item.id)) break;
    seen.add(next.item.id);
    current = next;
  }
  return current;
}
