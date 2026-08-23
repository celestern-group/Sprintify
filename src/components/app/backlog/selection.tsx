"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Shared "nothing picked" identity, so a cleared selection stays the same object. */
const EMPTY: ReadonlySet<string> = new Set();

/**
 * Which items the next right-click acts on.
 *
 * It lives ABOVE the four views rather than inside one, so a set picked in the
 * list is still the set when you switch to the board — the views disagree about
 * how a row looks, not about which work you meant. Transient on purpose: a
 * selection is made to do one thing and then dropped, so persisting it would
 * greet you tomorrow with three rows ticked and no memory of why.
 *
 * The shift-anchor is a ref, not state: it changes on every pick and nothing
 * renders from it, so keeping it in state would re-render the whole backlog to
 * remember where a range starts.
 */
export type ItemSelection = {
  ids: ReadonlySet<string>;
  /**
   * Tick or untick one item. `extend` adds everything between the anchor and
   * this item, measured against `orderedIds` — the order the CALLING view draws
   * its rows in, which is the only order a range means anything in.
   */
  select: (
    itemId: string,
    options?: { extend?: boolean; orderedIds?: readonly string[] },
  ) => void;
  /** Make this the whole selection — what a right-click outside one does. */
  only: (itemId: string) => void;
  /** Replace the selection with every item currently visible in a view. */
  selectAll: (itemIds: readonly string[]) => void;
  clear: () => void;
};

export function useItemSelection(): ItemSelection {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY);
  const anchor = useRef<string | null>(null);

  const select = useCallback<ItemSelection["select"]>((itemId, options) => {
    const orderedIds = options?.orderedIds ?? [];
    const from = anchor.current ? orderedIds.indexOf(anchor.current) : -1;
    const to = orderedIds.indexOf(itemId);
    setIds((current) => {
      const next = new Set(current);
      if (options?.extend && from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        for (const id of orderedIds.slice(start, end + 1)) next.add(id);
        return next;
      }
      if (!next.delete(itemId)) next.add(itemId);
      return next;
    });
    // A shift-click extends the existing range rather than starting a new one.
    if (!options?.extend) anchor.current = itemId;
  }, []);

  const only = useCallback<ItemSelection["only"]>((itemId) => {
    anchor.current = itemId;
    setIds(new Set([itemId]));
  }, []);

  const selectAll = useCallback<ItemSelection["selectAll"]>((itemIds) => {
    anchor.current = itemIds.at(-1) ?? null;
    setIds(new Set(itemIds));
  }, []);

  const clear = useCallback(() => {
    anchor.current = null;
    setIds(EMPTY);
  }, []);

  return { ids, select, only, selectAll, clear };
}

/**
 * A row's tick box. Hidden until the row is hovered or focused — a permanent
 * column of empty boxes down a backlog reads as a form, not a list — but the
 * 16px slot is always reserved, so nothing shifts sideways when one appears.
 *
 * The shift modifier is read off the native event Base UI hands back rather
 * than a click handler of our own, so the box stays one control with one
 * keyboard behaviour.
 */
export function SelectBox({
  item,
  selection,
  orderedIds,
  className,
}: {
  item: { id: string; key: string };
  selection: ItemSelection;
  /** The order this view draws its rows in — what a shift-range spans. */
  orderedIds: readonly string[];
  className?: string;
}) {
  const selected = selection.ids.has(item.id);
  return (
    <Checkbox
      checked={selected}
      onCheckedChange={(_, details) =>
        selection.select(item.id, {
          extend:
            "shiftKey" in details.event && details.event.shiftKey === true,
          orderedIds,
        })
      }
      aria-label={`Select ${item.key}`}
      className={cn(
        "shrink-0 transition-opacity",
        !selected &&
          selection.ids.size === 0 &&
          "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100",
        className,
      )}
    />
  );
}

/**
 * Whether a click meant "add this to the selection" rather than "open this".
 *
 * The board's cards and the timeline's rows have nowhere sensible to hang a
 * tick box — a card is three lines of content in a 288px column, and a Gantt
 * row is a fixed-height slot aligned to a bar — so on those two surfaces the
 * modifier IS the gesture: ctrl/⌘-click adds one, shift-click extends a range.
 * Both views also say so in the selection banner above them.
 */
export function isSelectionClick(event: ReactMouseEvent): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}
