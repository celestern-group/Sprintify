import type { WorkItemPriority } from "@/db/schema/work-items";
import type { WorkItemRow } from "@/lib/actions/work-items";

/**
 * One drag, from any view. `undefined` means "leave it alone", `null` means
 * "clear it" — the distinction is what lets the same payload move a card
 * between columns without disturbing its sprint, and back to the backlog
 * without disturbing its column.
 */
export type MovePayload = {
  workItemId: string;
  statusId?: string;
  sprintId?: string | null;
  /**
   * Set only by the nested backlog list, and only when the drop actually
   * re-parents. `undefined` (a plain re-rank, every other view) must leave the
   * hierarchy alone. It travels in the SAME `moveWorkItem` call as the rank:
   * the parent change needs `item:update` where the rank needs
   * `backlog:prioritize`, and two calls could land one and be refused the
   * other.
   */
  parentId?: string | null;
  beforeId?: string | null;
  afterId?: string | null;
};

/** A selected list block dropped between two unselected neighbours. */
export type MoveItemsPayload = {
  workItemIds: string[];
  sprintId?: string | null;
  beforeId?: string | null;
  afterId?: string | null;
};

/**
 * One edit made from the backlog's right-click menu, over one row or over the
 * whole selection. PATCH-shaped like `MovePayload` and read the same way:
 * `undefined` leaves the field alone, `null` clears it.
 *
 * Deliberately NOT folded into `MovePayload`: a move computes a rank from the
 * neighbours it was dropped between, and a menu points at no neighbours at all.
 */
export type AttributesPayload = {
  workItemIds: string[];
  statusId?: string;
  sprintId?: string | null;
  assigneeMemberId?: string | null;
  priority?: WorkItemPriority;
  points?: number | null;
};

/**
 * How the ranked list is carved up. `none` is the default: ONE ranked list of
 * everything, with the sprint each item sits in shown as a chip on its row —
 * sprint membership is a property of an item, not a reason to see the same epic
 * repeated once per sprint card. `sprint` brings the per-sprint cards back,
 * because dragging a row into a sprint group is how planning is done and there
 * is no other gesture for it.
 */
export type BacklogGrouping = "none" | "sprint";

/** What each view needs to render and act on the caller's rights. */
export type BacklogAbilities = {
  create: boolean;
  update: boolean;
  delete: boolean;
  assign: boolean;
  prioritize: boolean;
};

export type OpenItem = (item: WorkItemRow) => void;

/**
 * What an "add work here" gesture on the backlog screen already knows: the
 * sprint section its `+` sits on, the status column it came from. `null` means
 * "nothing implied" — the composer falls back to the backlog and the project's
 * default status. Every gesture opens the SAME inline composer with this as its
 * seed, so there is one create form on the screen rather than one per surface.
 */
export type ComposerSeed = {
  sprintId: string | null;
  statusId: string | null;
};

/**
 * Everything the toolbar's search and filters read off a row. A `WorkItemRow`
 * satisfies it, and so does the thin summary the inline composer reports after a
 * create — which is how the panel can tell that a brand-new item is hidden by
 * the filters that were already narrowing the list.
 */
export type FilterableRow = Pick<
  WorkItemRow,
  | "id"
  | "key"
  | "summary"
  | "labels"
  | "statusId"
  | "typeId"
  | "sprintId"
  | "assigneeMemberId"
>;
