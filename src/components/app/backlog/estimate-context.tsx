"use client";

import { createContext, useContext, useMemo } from "react";
import {
  type EffectiveEstimate,
  type EstimateNode,
  effectiveEstimates,
} from "@/lib/estimate-rollup";

/**
 * One roll-up pass per backlog render, read by whichever row happens to need
 * it.
 *
 * A derived estimate depends on the WHOLE project — a story's number can come
 * from two sub-tasks the current filter is hiding — so it cannot be computed
 * from the props a row holds. Threading it down instead would mean adding an
 * `estimates` prop to the list, the board, the table, the timeline and every
 * card and cell inside them, for a value that is the same map in all five
 * places. Context carries it once; `useItemEstimate` is what a leaf calls.
 */
const EstimateContext = createContext<ReadonlyMap<
  string,
  EffectiveEstimate
> | null>(null);

export function EstimateProvider({
  items,
  children,
}: {
  /** EVERY item in the project, not the filtered view. */
  items: readonly EstimateNode[];
  children: React.ReactNode;
}) {
  const estimates = useMemo(() => effectiveEstimates(items), [items]);
  return (
    <EstimateContext.Provider value={estimates}>
      {children}
    </EstimateContext.Provider>
  );
}

/** The whole map, for callers that total a set rather than read one row. */
export function useEstimates(): ReadonlyMap<string, EffectiveEstimate> | null {
  return useContext(EstimateContext);
}

/**
 * One item's effective estimate. Outside a provider this degrades to the item's
 * own `points` — a surface that renders a card without the project loaded shows
 * what it actually knows rather than nothing.
 */
export function useItemEstimate(item: {
  id: string;
  points: number | null;
}): EffectiveEstimate {
  const estimates = useContext(EstimateContext);
  return (
    estimates?.get(item.id) ?? {
      value: item.points,
      source: "own",
      childCount: 0,
      contributors: 0,
    }
  );
}

/** The words under a rolled-up number, for a `title`/`aria-label`. */
export function describeEstimate(
  estimate: EffectiveEstimate,
  unitLabel: string,
): string {
  if (estimate.value === null) {
    return estimate.childCount > 0
      ? "Unestimated — no child item carries an estimate"
      : "Unestimated";
  }
  if (estimate.source === "own")
    return `${estimate.value}${unitLabel} estimated`;
  return `${estimate.value}${unitLabel}, rolled up from ${estimate.contributors} estimated item${
    estimate.contributors === 1 ? "" : "s"
  }`;
}
