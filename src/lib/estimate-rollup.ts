/**
 * A parent's estimate is its children's, until someone says otherwise.
 *
 * `workItem.points` stores exactly one thing: the number a PERSON typed. It is
 * never written by a roll-up, because a stored roll-up is a cache with no
 * invalidation story — every re-parent, every delete, every child edit would
 * have to walk upward and rewrite ancestors, and the one write that missed
 * would leave a parent quietly claiming a total nobody can reproduce. The
 * derived value is computed here instead, from rows the caller already holds:
 * the backlog loads the whole project in one query, and the detail page loads
 * the same list, so the roll-up costs a pass over an array, not a round trip.
 *
 * The rules, in precedence order:
 *
 * 1. `points` set        → that value, and children are ignored entirely. An
 *                          explicit estimate is a decision; a parent may
 *                          legitimately be sized above or below the sum of what
 *                          is currently broken out under it.
 * 2. children exist      → the sum of their EFFECTIVE estimates, recursively,
 *                          so a grandparent sees work broken out two levels
 *                          down. Children that contribute nothing contribute
 *                          nothing — an unestimated child is not a zero.
 * 3. otherwise           → null, "unestimated".
 *
 * Rule 3 is deliberately null rather than 0. `workItem.points` is nullable
 * precisely so "nobody has sized this" and "this is free" stay distinguishable,
 * and an empty epic reading 0h would drop out of every "N items without
 * estimate" prompt in the product while looking like a finished decision.
 */

/** The only columns the arithmetic reads. `WorkItemRow` satisfies this. */
export type EstimateNode = {
  id: string;
  parentId: string | null;
  points: number | null;
};

export type EstimateSource = "own" | "rollup";

export type EffectiveEstimate = {
  /** The estimate to SHOW. Null is unestimated — never render it as 0. */
  value: number | null;
  /** Where `value` came from: typed by someone, or summed from below. */
  source: EstimateSource;
  /** Direct children, so a view can say "rolled up from 3 items". */
  childCount: number;
  /** Descendants at every depth that carried an estimate into `value`. */
  contributors: number;
};

const UNESTIMATED: EffectiveEstimate = {
  value: null,
  source: "own",
  childCount: 0,
  contributors: 0,
};

/**
 * `points` is `numeric(10,2)`, so every real value has at most two decimals —
 * but summing them in binary floating point does not (0.1 + 0.2). Round at each
 * step so a roll-up of eight half-hour tasks reads 4, not 3.9999999999999996.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Direct children of every node, keyed by parent id. */
function childrenByParent<T extends EstimateNode>(
  nodes: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const bucket = out.get(node.parentId);
    if (bucket) bucket.push(node);
    else out.set(node.parentId, [node]);
  }
  return out;
}

/**
 * The effective estimate of every node, in one pass over the project.
 *
 * Pass ALL of the project's items, not a filtered view: a parent's total has to
 * stay true when a status filter is hiding half of what is under it, exactly
 * like `rollupsOf` in `work-item-tree.ts`.
 */
export function effectiveEstimates(
  nodes: readonly EstimateNode[],
): Map<string, EffectiveEstimate> {
  const childrenOf = childrenByParent(nodes);
  const memo = new Map<string, EffectiveEstimate>();
  const visiting = new Set<string>();

  function compute(node: EstimateNode): EffectiveEstimate {
    const cached = memo.get(node.id);
    if (cached) return cached;

    // An override short-circuits before the walk: children are irrelevant, and
    // not descending is also what keeps an override safe on corrupt data.
    if (node.points !== null) {
      const own: EffectiveEstimate = {
        value: node.points,
        source: "own",
        childCount: childrenOf.get(node.id)?.length ?? 0,
        contributors: 0,
      };
      memo.set(node.id, own);
      return own;
    }

    const children = childrenOf.get(node.id) ?? [];
    if (children.length === 0) {
      memo.set(node.id, UNESTIMATED);
      return UNESTIMATED;
    }

    // A cycle can only come from corrupt data, but a recursive walk is not the
    // place to find out — bail unestimated rather than blowing the stack.
    if (visiting.has(node.id)) return UNESTIMATED;
    visiting.add(node.id);

    let total = 0;
    let contributors = 0;
    for (const child of children) {
      const sub = compute(child);
      if (sub.value === null) continue;
      total += sub.value;
      // An overridden child counts once; a rolled-up one reports the leaves
      // that actually carried a number.
      contributors += sub.source === "own" ? 1 : sub.contributors;
    }

    visiting.delete(node.id);
    // Every child unestimated means the parent is too. Summing them to 0 would
    // turn "nobody has sized this epic" into "this epic is free".
    const rollup: EffectiveEstimate =
      contributors === 0
        ? {
            value: null,
            source: "rollup",
            childCount: children.length,
            contributors: 0,
          }
        : {
            value: round2(total),
            source: "rollup",
            childCount: children.length,
            contributors,
          };
    memo.set(node.id, rollup);
    return rollup;
  }

  const out = new Map<string, EffectiveEstimate>();
  for (const node of nodes) out.set(node.id, compute(node));
  return out;
}

/** The effective estimate of one node, for callers holding a single row. */
export function effectiveEstimateOf(
  id: string,
  nodes: readonly EstimateNode[],
): EffectiveEstimate {
  return effectiveEstimates(nodes).get(id) ?? UNESTIMATED;
}

/**
 * Total estimate across a SET of items — a sprint, a backlog group, a filtered
 * list — without counting the same work twice.
 *
 * A parent's estimate already covers everything under it, whether it was typed
 * or summed. So when a parent and its child are both in the set, only the
 * outermost one counts: an item is skipped when any ANCESTOR of it is also in
 * the set. Summing raw `points` (the old behaviour) never double-counted only
 * because a rolled-up parent stored null; the moment parents carry a derived
 * total, "sum every row" would report an epic and its stories as twice the
 * work, and a sprint would read as over capacity on arithmetic alone.
 *
 * The consequence worth knowing: an epic scheduled into a sprint brings its
 * WHOLE subtree's estimate with it, including children scheduled elsewhere.
 * That is what putting the epic in the sprint says.
 *
 * `all` is the project (the roll-up is computed against it, so a hidden child
 * still counts toward its parent); `scope` is what to total.
 */
export function sumEstimates(
  scope: readonly EstimateNode[],
  all: readonly EstimateNode[] = scope,
  estimates: ReadonlyMap<string, EffectiveEstimate> = effectiveEstimates(all),
): number {
  const inScope = new Set(scope.map((node) => node.id));
  const byId = new Map(all.map((node) => [node.id, node]));

  let total = 0;
  for (const node of scope) {
    if (hasAncestorIn(node, inScope, byId)) continue;
    total += estimates.get(node.id)?.value ?? 0;
  }
  return round2(total);
}

/**
 * The share of `sumEstimates(scope)` that belongs to each item IN the scope.
 *
 * `sumEstimates` only de-duplicates within the one set it is handed, so running
 * it once per bucket (per assignee, per status) double-counts the moment a
 * parent and a child land in different buckets: the parent's roll-up already
 * covers the child, and the child is counted again in its own bucket. An epic
 * on Alice with a 3h task under it on Bob would report Alice 8 + Bob 3 against
 * a sprint total of 8. Attribution is therefore computed ONCE over the whole
 * scope, and the buckets are read off it — so they always add up to the total.
 *
 * The rule, walking down from each outermost in-scope item:
 *
 * - An **explicit** estimate is not decomposable. `effectiveEstimates` ignores
 *   children under an overridden parent, so the breakdown ignores them too —
 *   the whole value lands on that parent (or, if the parent itself was pulled
 *   in by an ancestor, on that ancestor).
 * - A **rolled-up** estimate is exactly its children's, so it hands each child
 *   down: a child in the scope owns its own subtree's number, a child outside
 *   the scope stays with the nearest in-scope ancestor. Work broken out into
 *   the view is attributed where it was broken out to; work that was not
 *   belongs to whatever brought it in.
 *
 * Every scope item gets an entry, including a 0 for a parent whose whole
 * subtree is broken out below it.
 */
export function attributeEstimates(
  scope: readonly EstimateNode[],
  all: readonly EstimateNode[] = scope,
  estimates: ReadonlyMap<string, EffectiveEstimate> = effectiveEstimates(all),
): Map<string, number> {
  const inScope = new Set(scope.map((node) => node.id));
  const byId = new Map(all.map((node) => [node.id, node]));
  const childrenOf = childrenByParent(all);
  const shares = new Map<string, number>();
  for (const node of scope) shares.set(node.id, 0);

  /** `owner` is the nearest in-scope ancestor-or-self of `node`. */
  function walk(node: EstimateNode, owner: string, seen: Set<string>) {
    const estimate = estimates.get(node.id);
    if (!estimate || estimate.value === null) return;
    if (estimate.source === "own") {
      shares.set(owner, (shares.get(owner) ?? 0) + estimate.value);
      return;
    }
    for (const child of childrenOf.get(node.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      walk(child, inScope.has(child.id) ? child.id : owner, seen);
    }
  }

  for (const node of scope) {
    // Same outermost-only entry as `sumEstimates`: a child under an in-scope
    // parent is reached by the walk, not started again from the top.
    if (hasAncestorIn(node, inScope, byId)) continue;
    walk(node, node.id, new Set([node.id]));
  }

  for (const [id, value] of shares) shares.set(id, round2(value));
  return shares;
}

/**
 * `attributeEstimates` collapsed onto a key — the per-assignee, per-status or
 * per-sprint breakdown of one scope. The buckets sum to `sumEstimates(scope)`,
 * which is the whole reason to build a breakdown this way instead of calling
 * `sumEstimates` once per bucket.
 */
export function bucketEstimates<T extends EstimateNode>(
  scope: readonly T[],
  keyOf: (node: T) => string,
  all: readonly EstimateNode[] = scope,
  estimates: ReadonlyMap<string, EffectiveEstimate> = effectiveEstimates(all),
): Map<string, number> {
  const shares = attributeEstimates(scope, all, estimates);
  const out = new Map<string, number>();
  for (const node of scope) {
    const key = keyOf(node);
    out.set(key, (out.get(key) ?? 0) + (shares.get(node.id) ?? 0));
  }
  for (const [key, value] of out) out.set(key, round2(value));
  return out;
}

/** Does any ancestor of `node` sit in `ids`? Bounded against data cycles. */
function hasAncestorIn(
  node: EstimateNode,
  ids: ReadonlySet<string>,
  byId: ReadonlyMap<string, EstimateNode>,
): boolean {
  const seen = new Set<string>([node.id]);
  let current = node.parentId;
  while (current && !seen.has(current)) {
    if (ids.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * How many items in `scope` have no estimate at all — the "N items without
 * estimate" prompt. A parent whose children are sized is NOT unestimated, which
 * is the whole point of the roll-up: it would otherwise nag about epics that
 * are fully broken down.
 */
export function countUnestimated(
  scope: readonly EstimateNode[],
  all: readonly EstimateNode[] = scope,
  estimates: ReadonlyMap<string, EffectiveEstimate> = effectiveEstimates(all),
): number {
  let count = 0;
  for (const node of scope) {
    if ((estimates.get(node.id)?.value ?? null) === null) count += 1;
  }
  return count;
}
