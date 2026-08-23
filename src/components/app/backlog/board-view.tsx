"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { IconPlus } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { ItemCard } from "@/components/app/backlog/item-card";
import {
  type BacklogMenuContext,
  ItemMenu,
} from "@/components/app/backlog/item-context-menu";
import { QuickAddCard } from "@/components/app/backlog/quick-add-card";
import { isSelectionClick } from "@/components/app/backlog/selection";
import type { MovePayload } from "@/components/app/backlog/types";
import { StatusCategoryIcon } from "@/components/app/backlog/work-item-visuals";
import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/kibo-ui/kanban";
import { Pill, PillIndicator } from "@/components/kibo-ui/pill";
import { useReturnToHref } from "@/hooks/use-return-to";
import type {
  WorkflowStatusRow,
  WorkItemRow,
  WorkItemTypeRow,
} from "@/lib/actions/work-items";
import { withReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";
import type { WorkItemFieldDefinition } from "@/lib/work-item-fields";
import { WORKFLOW_CATEGORY_CLASSES } from "@/lib/work-items";

/** One row in the shape Kibo's Kanban wants: an id, a name and a column. */
type BoardCard = {
  id: string;
  name: string;
  column: string;
  item: WorkItemRow;
};

/**
 * The Kanban board, on Kibo UI's Kanban primitives — one column per workflow
 * status, in the project's own column order.
 *
 * The server commit deliberately does NOT hang off `onDataChange`: Kibo fires
 * that mid-drag as well (every time a card crosses a column boundary), and each
 * of those would be a write, an audit row and a new rank. The callback keeps
 * the local copy in step for the visuals; the drop is committed exactly once,
 * from the final array.
 *
 * ACCESSIBILITY: Kibo's provider registers a KeyboardSensor and drag
 * announcements, so unlike the hand-rolled board this replaces, the columns are
 * operable without a pointer. Every card is also a real button that opens the
 * item dialog, where the same move is available through the status and sprint
 * selects.
 */
export function BoardView({
  items,
  statuses,
  types,
  fields,
  menu,
  canMove,
  canReorder,
  canCreate,
  basePath,
  onOpen,
  onMove,
  onQuickCreate,
}: {
  items: WorkItemRow[];
  statuses: WorkflowStatusRow[];
  types: WorkItemTypeRow[];
  /** The org's custom field catalog — the quick composer reads it to spot
      required fields it has nowhere to put. */
  fields: WorkItemFieldDefinition[];
  /** The right-click menu's catalogs, rights and shared selection. */
  menu: BacklogMenuContext;
  canMove: boolean;
  /**
   * Whether the caller may also set the item's POSITION (`backlog:prioritize`),
   * which is a different right from moving it between columns (`item:update`).
   * A Developer holds the second and not the first, so a drop that named its
   * neighbours was refused whole — the column change included.
   */
  canReorder: boolean;
  canCreate: boolean;
  basePath: string;
  onOpen: (item: WorkItemRow) => void;
  onMove: (payload: MovePayload) => void;
  /** Creates a title-only item in a column. Resolves false if the server
      refused, so the composer can keep what was typed. */
  onQuickCreate: (input: {
    statusId: string;
    typeId: string;
    summary: string;
  }) => Promise<boolean>;
}) {
  // Which column has its inline composer open — one at a time, so the board
  // never grows two half-written cards in different places.
  const [composing, setComposing] = useState<string | null>(null);
  // "Open the full form" leaves the board; the board is where cancelling or
  // saving should put you back.
  const returnTo = useReturnToHref();
  const toCards = (rows: WorkItemRow[]): BoardCard[] =>
    rows.map((item) => ({
      id: item.id,
      name: item.summary,
      column: item.statusId,
      item,
    }));

  // Kibo's Kanban is controlled: it hands back a whole new array on every
  // change. This mirrors it locally so the card follows the cursor, and
  // resyncs whenever the server sends a new list (adjusted during render — an
  // effect would paint the stale board for a frame first).
  const [cards, setCards] = useState<BoardCard[]>(() => toCards(items));
  const [renderedFrom, setRenderedFrom] = useState(items);
  if (renderedFrom !== items) {
    setRenderedFrom(items);
    setCards(toCards(items));
  }

  // The latest array Kibo produced, read one tick after the drop: Kibo runs its
  // own reorder and onDataChange immediately AFTER calling onDragEnd, so
  // reading state inside the handler would miss the final position.
  const latest = useRef<BoardCard[]>(cards);
  latest.current = cards;

  const columns = statuses.map((status) => ({
    id: status.id,
    name: status.name,
    status,
  }));

  const selectedIds = menu.selection.ids;
  // Board reading order — column by column, top to bottom — which is what a
  // shift-range has to span here. The `cards` array is in rank order, so using
  // it directly would let a range jump between columns.
  const orderedIds = columns.flatMap((column) =>
    cards.filter((card) => card.column === column.id).map((card) => card.id),
  );

  function handleDragEnd(event: DragEndEvent) {
    if (!canMove) return;
    const movedId = String(event.active.id);
    const original = items.find((item) => item.id === movedId);
    if (!original) return;

    setTimeout(() => {
      const finalCards = latest.current;
      const moved = finalCards.find((card) => card.id === movedId);
      if (!moved) return;

      const inColumn = finalCards.filter(
        (card) => card.column === moved.column,
      );
      const index = inColumn.findIndex((card) => card.id === movedId);
      const beforeId = inColumn[index - 1]?.id ?? null;
      const afterId = inColumn[index + 1]?.id ?? null;

      // Dropped back where it started — same column, same neighbours. Sending
      // it would burn a write and an audit row for nothing.
      const previous = neighboursOf(items, original);
      if (
        moved.column === original.statusId &&
        beforeId === previous.before &&
        afterId === previous.after
      ) {
        return;
      }

      // Without `backlog:prioritize` the only half of this drop the caller may
      // commit is the column. Send it WITHOUT neighbours (the server keeps the
      // existing rank) and put the card back where the server still has it,
      // rather than sending a position the server will refuse — which used to
      // fail the column change too.
      if (!canReorder) {
        if (moved.column === original.statusId) {
          setCards(toCards(items));
          return;
        }
        setCards(
          toCards(items).map((card) =>
            card.id === movedId ? { ...card, column: moved.column } : card,
          ),
        );
        onMove({ workItemId: movedId, statusId: moved.column });
        return;
      }

      onMove({
        workItemId: movedId,
        statusId: moved.column,
        beforeId,
        afterId,
      });
    }, 0);
  }

  return (
    <KanbanProvider<BoardCard, (typeof columns)[number]>
      columns={columns}
      data={cards}
      onDataChange={setCards}
      onDragEnd={handleDragEnd}
    >
      {(column) => {
        const inColumn = cards.filter((card) => card.column === column.id);
        const overLimit =
          column.status.wipLimit !== null &&
          inColumn.length > column.status.wipLimit;

        return (
          <KanbanBoard
            key={column.id}
            id={column.id}
            // Columns share the card surface (white in light, #17181b dark);
            // the hairline border and the cards' own shadow keep the layers
            // apart.
            className="w-72 shrink-0 border-border/70 bg-card shadow-none"
          >
            <KanbanHeader className="flex items-center gap-2 px-3 py-2.5">
              {/* Category glyph in category colour — shape + hue, so a column's
                  place in the flow reads before its name does. */}
              <StatusCategoryIcon
                category={column.status.category}
                className={cn(
                  "size-4 shrink-0",
                  WORKFLOW_CATEGORY_CLASSES[column.status.category],
                )}
              />
              <span className="truncate text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                {column.name}
              </span>
              {/* PillIndicator replaces the hand-rolled warning dot; it is
                  aria-hidden, so the sr-only clause is what keeps the over-limit
                  warning from being carried by colour alone. */}
              <Pill className="tabular-nums">
                {overLimit ? <PillIndicator variant="warning" /> : null}
                {inColumn.length}
                {column.status.wipLimit !== null
                  ? `/${column.status.wipLimit}`
                  : ""}
                {overLimit ? (
                  <span className="sr-only">, over WIP limit</span>
                ) : null}
              </Pill>
              {canCreate ? (
                // Opens the inline composer in THIS column rather than leaving
                // the board: a title is enough to create an item, and the
                // status comes from where you clicked. The full form is one
                // link away inside the composer for everything else.
                <button
                  type="button"
                  aria-expanded={composing === column.id}
                  aria-label={`New item in ${column.name}`}
                  onClick={() =>
                    setComposing((current) =>
                      current === column.id ? null : column.id,
                    )
                  }
                  className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <IconPlus className="size-4" />
                </button>
              ) : null}
            </KanbanHeader>
            {overLimit ? (
              <p className="px-3 pb-1 text-[11px] font-semibold text-warning">
                Over the WIP limit
              </p>
            ) : null}
            {inColumn.length === 0 && composing !== column.id ? (
              // A dashed well says "drop target", where a bare paragraph in
              // a void only said "nothing here". flex-[99…] out-grows the
              // (empty) card area's own flex-1, so the well takes the whole
              // full-height column rather than half of it.
              <div className="m-2 mt-0 flex flex-[99_1_0%] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border py-4">
                <p className="text-center text-xs text-muted-foreground">
                  Nothing in {column.name}.
                </p>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setComposing(column.id)}
                    className="text-xs font-semibold text-brand"
                  >
                    New item
                  </button>
                ) : null}
              </div>
            ) : null}
            <KanbanCards<BoardCard> id={column.id} className="min-h-24">
              {(card: BoardCard) => (
                <ItemMenu key={card.id} context={menu} item={card.item}>
                  {/* The menu hangs off a wrapper, not the card: `KanbanCard`
                      owns its own draggable div and Base UI's trigger needs a
                      real element to clone. The wrapper is also where a
                      selection click is intercepted, so the card's own button
                      keeps meaning "open this". */}
                  <div
                    className={cn(
                      "rounded-lg",
                      selectedIds.has(card.id) && "ring-2 ring-primary",
                    )}
                    onClickCapture={(event) => {
                      if (!isSelectionClick(event)) return;
                      // Ctrl/⌘/shift-click picks the card instead of opening
                      // it — a board card has nowhere to put a tick box.
                      event.preventDefault();
                      event.stopPropagation();
                      menu.selection.select(card.id, {
                        extend: event.shiftKey,
                        orderedIds,
                      });
                    }}
                  >
                    <KanbanCard
                      {...card}
                      className="border-border bg-card p-0 shadow-card transition-all hover:shadow-float motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none"
                    >
                      <ItemCard
                        item={card.item}
                        types={types}
                        onOpen={onOpen}
                        className="border-0 shadow-none"
                      />
                    </KanbanCard>
                  </div>
                </ItemMenu>
              )}
            </KanbanCards>
            {canCreate && composing === column.id ? (
              // Pinned under the card list, not over it: a create ranks last,
              // so the new card appears exactly where the composer sits.
              <div className="p-2 pt-0">
                <QuickAddCard
                  statusId={column.id}
                  statusName={column.name}
                  types={types}
                  fields={fields}
                  fullFormHref={withReturnTo(
                    `${basePath}/backlog/new`,
                    returnTo,
                  )}
                  onCreate={onQuickCreate}
                  onClose={() => setComposing(null)}
                />
              </div>
            ) : null}
          </KanbanBoard>
        );
      }}
    </KanbanProvider>
  );
}

/** The neighbours an item had before the drag, used to spot a no-op drop. */
function neighboursOf(items: WorkItemRow[], item: WorkItemRow) {
  const column = items.filter((row) => row.statusId === item.statusId);
  const index = column.findIndex((row) => row.id === item.id);
  return {
    before: column[index - 1]?.id ?? null,
    after: column[index + 1]?.id ?? null,
  };
}
