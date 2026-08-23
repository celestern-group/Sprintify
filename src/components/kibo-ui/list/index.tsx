"use client";

// Kibo UI List — vendored from https://www.kibo-ui.com/components/list.
//
// Upstream only makes GROUPS droppable, so a drop can change which group an
// item is in but not where it sits inside one. The backlog needs both (rank is
// the whole point of a backlog), so the consuming view — see
// src/components/app/backlog/backlog-list-view.tsx — wraps each ListItem in its
// own droppable and reads whichever id the pointer landed on. No change needed
// here; noted so the composition doesn't look accidental.
//
// LOCAL CHANGES (keep these when re-pulling upstream):
//  - Aurora v0.3 theming: ListGroup is `bg-card` (upstream `bg-secondary` is
//    the violet selection tint here), ListHeader falls back to `bg-muted`, and
//    ListItem's default chrome is neutralized (`bg-transparent shadow-none`) —
//    its consumer supplies the row styling.
//  - Drag-over highlight bug fix: upstream put `isOver && "bg-foreground/10"`
//    BEFORE `className` in cn(), so any consumer bg-* silently beat the
//    highlight. The isOver class now comes after className and uses the
//    opaque neutral `bg-accent` hover token.
//  - DragOverlay instead of transform: upstream translates the dragged row in
//    place, which overflow-hidden group cards clip. ListItem now dims to a
//    placeholder while dragging and ListProvider portals a DragOverlay (the
//    consumer supplies the preview via the `overlay` prop).
//  - Handle mode: upstream makes the WHOLE row the drag activator, so a row
//    carrying buttons, checkboxes and text can only be dragged by guessing
//    which pixels are inert. `handle` moves the activator onto a
//    <ListItemDragHandle>: the row keeps the draggable NODE (that's the
//    measured rect) while the handle takes the listeners via
//    setActivatorNodeRef, which is also what the keyboard sensor focuses.

import {
  type CollisionDetection,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { IconGripVertical } from "@tabler/icons-react";
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type { DragEndEvent } from "@dnd-kit/core";

type Status = {
  id: string;
  name: string;
  color: string;
};

type Feature = {
  id: string;
  name: string;
  startAt: Date;
  endAt: Date;
  status: Status;
};

export type ListItemsProps = {
  children: ReactNode;
  className?: string;
};

export const ListItems = ({ children, className }: ListItemsProps) => (
  <div className={cn("flex flex-1 flex-col gap-2 p-3", className)}>
    {children}
  </div>
);

export type ListHeaderProps =
  | {
      children: ReactNode;
    }
  | {
      name: Status["name"];
      color: Status["color"];
      className?: string;
    };

export const ListHeader = (props: ListHeaderProps) =>
  "children" in props ? (
    props.children
  ) : (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 bg-muted p-3",
        props.className,
      )}
    >
      <div
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: props.color }}
      />
      <p className="m-0 font-semibold text-sm">{props.name}</p>
    </div>
  );

export type ListGroupProps = {
  id: Status["id"];
  children: ReactNode;
  className?: string;
};

export const ListGroup = ({ id, children, className }: ListGroupProps) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      className={cn(
        "bg-card transition-colors",
        className,
        isOver && "bg-accent",
      )}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
};

type DragActivator = {
  listeners: ReturnType<typeof useDraggable>["listeners"];
  attributes: ReturnType<typeof useDraggable>["attributes"];
  setActivatorNodeRef: ReturnType<typeof useDraggable>["setActivatorNodeRef"];
  name: string;
};

/**
 * LOCAL: only populated by a `handle` ListItem. Null everywhere else, which is
 * what makes a stray <ListItemDragHandle> render nothing instead of a dead grip
 * that looks draggable and isn't.
 */
const ListItemDragContext = createContext<DragActivator | null>(null);

export type ListItemDragHandleProps = {
  /** Overrides the default "Reorder <name>" label. */
  readonly label?: string;
  readonly className?: string;
};

/**
 * LOCAL: the drag activator for a `handle` ListItem. A real <button> — it takes
 * focus, so the keyboard sensor has something to start from, and dnd-kit's
 * attributes give it the role/aria-roledescription a pointer-only grip lacks.
 */
export const ListItemDragHandle = ({
  label,
  className,
}: ListItemDragHandleProps) => {
  const drag = useContext(ListItemDragContext);
  if (!drag) return null;

  return (
    <button
      type="button"
      aria-label={label ?? `Reorder ${drag.name}`}
      className={cn(
        "-my-1 shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        className,
      )}
      ref={drag.setActivatorNodeRef}
      {...drag.listeners}
      {...drag.attributes}
    >
      <IconGripVertical aria-hidden className="size-4" />
    </button>
  );
};

export type ListItemProps = Pick<Feature, "id" | "name"> & {
  readonly index: number;
  readonly parent: string;
  readonly children?: ReactNode;
  readonly className?: string;
  /**
   * LOCAL: drag starts on a <ListItemDragHandle> child instead of anywhere on
   * the row. The row stays the measured draggable node either way.
   */
  readonly handle?: boolean;
};

export const ListItem = ({
  id,
  name,
  index,
  parent,
  children,
  className,
  handle = false,
}: ListItemProps) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id,
      data: { index, parent },
    });

  // LOCAL: upstream translates the row itself with `transform`, but groups are
  // `overflow-hidden` cards, so the row vanished the moment it crossed its
  // group's edge. The moving preview is now the ListProvider's DragOverlay
  // (portaled to <body>); the original stays put as a dimmed placeholder.
  const row = (
    <div
      className={cn(
        "flex items-center gap-2 bg-transparent p-2 shadow-none",
        handle ? "cursor-default" : "cursor-grab",
        isDragging && "pointer-events-none cursor-grabbing opacity-30",
        className,
      )}
      {...(handle ? {} : listeners)}
      {...(handle ? {} : attributes)}
      ref={setNodeRef}
    >
      {children ?? <p className="m-0 font-medium text-sm">{name}</p>}
    </div>
  );

  if (!handle) return row;

  return (
    <ListItemDragContext.Provider
      value={{ listeners, attributes, setActivatorNodeRef, name }}
    >
      {row}
    </ListItemDragContext.Provider>
  );
};

export type ListProviderProps = {
  children: ReactNode;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragCancel?: (event: DragCancelEvent) => void;
  /**
   * LOCAL: fires as the pointer crosses droppables. A view whose drop targets
   * mean different THINGS (the backlog's nest vs before vs after) needs this to
   * narrate the pending drop while the pointer is still moving — a highlight
   * inside a 14px band is not enough on its own.
   */
  onDragOver?: (event: DragOverEvent) => void;
  /** Rendered inside a portaled DragOverlay while a drag is active — the
   *  moving row preview. The consumer owns what it looks like. */
  overlay?: ReactNode;
  /**
   * LOCAL: overrides the default `rectIntersection`. A view that stacks small
   * drop bands inside a row (the backlog's nest/before/after zones) needs a
   * POINTER-based detector — rect intersection compares areas, so a full-width
   * row always beats a band drawn inside it and the bands become unreachable.
   */
  collisionDetection?: CollisionDetection;
  className?: string;
};

export const ListProvider = ({
  children,
  onDragEnd,
  onDragStart,
  onDragCancel,
  onDragOver,
  overlay,
  collisionDetection = rectIntersection,
  className,
}: ListProviderProps) => {
  // LOCAL: same fix as the Kanban — upstream lets DndContext fall back to the
  // default sensors, which begin a drag on pointerdown and swallow the click
  // that follows. Rows carry buttons (open the item), so a click has to
  // survive; a drag now needs a few pixels of movement first.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor),
  );

  return (
    <DndContext
      collisionDetection={collisionDetection}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragOver={onDragOver}
      sensors={sensors}
    >
      <div className={cn("flex size-full flex-col", className)}>{children}</div>
      {/* LOCAL: portaled to <body> like the Kanban's — groups are
          overflow-hidden cards, so an in-place preview would be clipped. */}
      {typeof window !== "undefined" &&
        createPortal(<DragOverlay>{overlay}</DragOverlay>, document.body)}
    </DndContext>
  );
};
