"use client";

import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconFlag,
  IconProgress,
  IconRocket,
  IconStack2,
  IconUnlink,
  IconUser,
  IconUserOff,
  IconWeight,
  IconX,
} from "@tabler/icons-react";
import type { ReactElement, ReactNode } from "react";
import type { ItemSelection } from "@/components/app/backlog/selection";
import type { AttributesPayload } from "@/components/app/backlog/types";
import {
  PriorityMark,
  StatusCategoryIcon,
} from "@/components/app/backlog/work-item-visuals";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_PRIORITY_LABELS,
} from "@/db/schema/work-items";
import type {
  BacklogMemberRow,
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemRow,
} from "@/lib/actions/work-items";
import { initialsOf } from "@/lib/work-items";

/** The sentinel for "no value" — a radio group's value has to be a string. */
const NONE = "none";

/**
 * Everything the right-click menu needs that is the same in all four views:
 * the catalogs it offers, the three rights it is gated on, the selection it
 * acts through, and the two callbacks that write.
 *
 * Bundled rather than threaded as a dozen props because the views don't consume
 * any of it — the list, the board, the table and the timeline hand it straight
 * back to `ItemMenu` — and a dozen pass-through props on four components is
 * four places to forget one.
 */
export type BacklogMenuContext = {
  members: BacklogMemberRow[];
  sprints: BacklogSprintRow[];
  statuses: WorkflowStatusRow[];
  capacityUnit: "hours" | "points";
  /** `item:assign` */
  canAssign: boolean;
  /** `backlog:prioritize` */
  canSchedule: boolean;
  /** `item:update` */
  canUpdate: boolean;
  selection: ItemSelection;
  /** The rows a menu opened on `item` would write — see `ItemMenu`. */
  targetsFor: (item: WorkItemRow) => WorkItemRow[];
  onApply: (payload: AttributesPayload) => void;
  onOpen: (item: WorkItemRow) => void;
};

/**
 * The menu as a view uses it: wrap the row/card element, name the item under
 * the cursor, and let the shared context answer everything else.
 *
 * Opening on an item that isn't in the selection makes it THE selection, so the
 * ticks on screen and the menu's targets can never disagree — and the header's
 * "3 items" is trustworthy.
 */
export function ItemMenu({
  context,
  item,
  canUnnest = false,
  onUnnest,
  canReorder = false,
  onReorder,
  children,
}: {
  context: BacklogMenuContext;
  item: WorkItemRow;
  canUnnest?: boolean;
  onUnnest?: (item: WorkItemRow) => void;
  /** Timeline-only ordering controls; the list and board provide direct drag. */
  canReorder?: boolean;
  onReorder?: (direction: "earlier" | "later") => void;
  children: ReactElement;
}) {
  return (
    <WorkItemContextMenu
      targets={context.targetsFor(item)}
      members={context.members}
      sprints={context.sprints}
      statuses={context.statuses}
      capacityUnit={context.capacityUnit}
      canAssign={context.canAssign}
      canSchedule={context.canSchedule}
      canUpdate={context.canUpdate}
      canUnnest={canUnnest}
      canReorder={canReorder}
      onApply={context.onApply}
      onOpen={context.onOpen}
      onUnnest={onUnnest}
      onReorder={onReorder}
      onOpenChange={(open) => {
        if (open && !context.selection.ids.has(item.id)) {
          context.selection.only(item.id);
        }
      }}
      onClearSelection={context.selection.clear}
    >
      {children}
    </WorkItemContextMenu>
  );
}

/**
 * The estimate ladder the menu offers. Deliberately a short list rather than a
 * number field: a menu is for the common answer, and anything else is a job for
 * the item page. Fibonacci-ish because that is what a team sizing in points
 * reaches for, and it reads as plausible hours too.
 */
const POINT_STEPS = [1, 2, 3, 5, 8, 13] as const;

/**
 * The backlog's right-click menu: assign, schedule, and set the attributes a
 * row already shows, without leaving the list.
 *
 * It wraps the row itself (`render={children}`) rather than adding a wrapper
 * element — the rows are hairline-divided siblings inside a card, so an extra
 * div between them would make every row the only child of its own parent and
 * `last:border-b-0` would erase every divider.
 *
 * Every entry acts on `targets`, which is the whole selection when the row that
 * was right-clicked is part of one and just that row otherwise — the list owns
 * that decision (see `onOpenChange`) because it owns the selection.
 *
 * Sections are hidden, not disabled, when the caller lacks the right: the three
 * gates here are different rights (assigning, scheduling, editing), so a menu
 * of greyed-out submenus would be a list of things this person can never do.
 */
export function WorkItemContextMenu({
  targets,
  members,
  sprints,
  statuses,
  capacityUnit,
  canAssign,
  canSchedule,
  canUpdate,
  canUnnest = false,
  canReorder = false,
  onApply,
  onOpen,
  onUnnest,
  onReorder,
  onOpenChange,
  onClearSelection,
  children,
}: {
  /** The rows this menu acts on — one, or the whole selection. */
  targets: WorkItemRow[];
  members: BacklogMemberRow[];
  sprints: BacklogSprintRow[];
  statuses: WorkflowStatusRow[];
  capacityUnit: "hours" | "points";
  /** `item:assign` */
  canAssign: boolean;
  /** `backlog:prioritize` */
  canSchedule: boolean;
  /** `item:update` */
  canUpdate: boolean;
  /** Whether the single target actually hangs off a parent. */
  canUnnest?: boolean;
  /** Reordering is distinct from editing: it requires backlog:prioritize. */
  canReorder?: boolean;
  onApply: (payload: AttributesPayload) => void;
  onOpen: (item: WorkItemRow) => void;
  onUnnest?: (item: WorkItemRow) => void;
  onReorder?: (direction: "earlier" | "later") => void;
  /** Fires as the menu opens, so the list can point it at the right rows. */
  onOpenChange?: (open: boolean) => void;
  onClearSelection?: () => void;
  /** The row element the menu hangs off. */
  children: ReactElement;
}) {
  const item = targets[0];
  const single = targets.length === 1;
  const workItemIds = targets.map((row) => row.id);
  const unitLabel = capacityUnit === "points" ? "pts" : "h";

  // Only sprints that can still take work: the server refuses a completed one,
  // and the drag doesn't offer them either.
  const openSprints = sprints.filter((sprint) => sprint.state !== "completed");

  /** What every target shares, or `undefined` when they disagree — which is
   *  what leaves a submenu with nothing ticked instead of lying about one. */
  function shared<T>(read: (row: WorkItemRow) => T): T | undefined {
    const first = read(targets[0]);
    return targets.every((row) => read(row) === first) ? first : undefined;
  }

  const sharedAssignee = shared((row) => row.assigneeMemberId);
  const sharedSprint = shared((row) => row.sprintId);
  const sharedStatus = shared((row) => row.statusId);
  const sharedPriority = shared((row) => row.priority);
  const sharedPoints = shared((row) => row.points);

  const nothingAllowed =
    !canAssign && !canSchedule && !canUpdate && !canReorder;

  return (
    <ContextMenu onOpenChange={(open) => onOpenChange?.(open)}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-60">
        {/* The label lives INSIDE a group on purpose: Base UI's GroupLabel
            reads its group's context and throws outright without one. The
            group it names is everything this menu would write. */}
        <ContextMenuGroup>
          <ContextMenuLabel className="truncate px-3 py-2 font-semibold text-foreground">
            {single
              ? `${item.key} · ${item.summary}`
              : `${targets.length} items`}
          </ContextMenuLabel>
          <ContextMenuSeparator />

          {single ? (
            <ContextMenuItem onClick={() => onOpen(item)}>
              <IconArrowRight />
              Open item
            </ContextMenuItem>
          ) : null}

          {canAssign ? (
            <AttributeSub
              icon={<IconUser />}
              label="Assign to"
              value={
                sharedAssignee === undefined ? "" : (sharedAssignee ?? NONE)
              }
              onValueChange={(value) =>
                onApply({
                  workItemIds,
                  assigneeMemberId: value === NONE ? null : value,
                })
              }
            >
              <ContextMenuRadioItem closeOnClick value={NONE}>
                <IconUserOff className="text-muted-foreground" />
                Unassigned
              </ContextMenuRadioItem>
              {members.map((row) => (
                <ContextMenuRadioItem
                  closeOnClick
                  key={row.memberId}
                  value={row.memberId}
                >
                  <Avatar className="size-5">
                    {row.image ? <AvatarImage src={row.image} alt="" /> : null}
                    <AvatarFallback className="text-[9px]">
                      {initialsOf(row.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 truncate">{row.name}</span>
                </ContextMenuRadioItem>
              ))}
            </AttributeSub>
          ) : null}

          {canSchedule ? (
            <AttributeSub
              icon={<IconRocket />}
              label="Sprint"
              value={sharedSprint === undefined ? "" : (sharedSprint ?? NONE)}
              onValueChange={(value) =>
                onApply({
                  workItemIds,
                  sprintId: value === NONE ? null : value,
                })
              }
            >
              <ContextMenuRadioItem closeOnClick value={NONE}>
                <IconStack2 className="text-muted-foreground" />
                Backlog
              </ContextMenuRadioItem>
              {openSprints.map((sprint) => (
                <ContextMenuRadioItem
                  closeOnClick
                  key={sprint.id}
                  value={sprint.id}
                >
                  <IconRocket className="text-brand" />
                  <span className="min-w-0 truncate">{sprint.name}</span>
                </ContextMenuRadioItem>
              ))}
              {openSprints.length === 0 ? (
                <ContextMenuItem disabled>No open sprints</ContextMenuItem>
              ) : null}
            </AttributeSub>
          ) : null}

          {canUpdate ? (
            <>
              <AttributeSub
                icon={<IconProgress />}
                label="Status"
                value={sharedStatus ?? ""}
                onValueChange={(value) =>
                  onApply({ workItemIds, statusId: value })
                }
              >
                {statuses.map((status) => (
                  <ContextMenuRadioItem
                    closeOnClick
                    key={status.id}
                    value={status.id}
                  >
                    <StatusCategoryIcon category={status.category} />
                    <span className="min-w-0 truncate">{status.name}</span>
                  </ContextMenuRadioItem>
                ))}
              </AttributeSub>

              <AttributeSub
                icon={<IconFlag />}
                label="Priority"
                value={sharedPriority ?? ""}
                onValueChange={(value) =>
                  onApply({
                    workItemIds,
                    priority: value as WorkItemRow["priority"],
                  })
                }
              >
                {WORK_ITEM_PRIORITIES.map((priority) => (
                  <ContextMenuRadioItem
                    closeOnClick
                    key={priority}
                    value={priority}
                  >
                    <PriorityMark priority={priority} />
                    {WORK_ITEM_PRIORITY_LABELS[priority]}
                  </ContextMenuRadioItem>
                ))}
              </AttributeSub>

              <AttributeSub
                icon={<IconWeight />}
                label="Estimate"
                value={
                  sharedPoints === undefined
                    ? ""
                    : sharedPoints === null
                      ? NONE
                      : String(sharedPoints)
                }
                onValueChange={(value) =>
                  onApply({
                    workItemIds,
                    points: value === NONE ? null : Number(value),
                  })
                }
              >
                <ContextMenuRadioItem closeOnClick value={NONE}>
                  No estimate
                </ContextMenuRadioItem>
                {POINT_STEPS.map((points) => (
                  <ContextMenuRadioItem
                    closeOnClick
                    key={points}
                    value={String(points)}
                  >
                    <span className="tabular-nums">
                      {points}
                      {unitLabel}
                    </span>
                  </ContextMenuRadioItem>
                ))}
              </AttributeSub>
            </>
          ) : null}
        </ContextMenuGroup>

        {single && canUnnest && onUnnest ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onUnnest(item)}>
              <IconUnlink />
              Detach from parent
            </ContextMenuItem>
          </>
        ) : null}

        {single && canReorder && onReorder ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onReorder("earlier")}>
              <IconArrowUp />
              Move earlier
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onReorder("later")}>
              <IconArrowDown />
              Move later
            </ContextMenuItem>
          </>
        ) : null}

        {!single && onClearSelection ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onClearSelection}>
              <IconX />
              Clear selection
            </ContextMenuItem>
          </>
        ) : null}

        {nothingAllowed ? (
          <ContextMenuItem disabled>
            You can't edit items in this project
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * One attribute as a submenu of radio options. A radio group rather than plain
 * items because the tick is the answer to "what is it now" — and with several
 * rows selected that answer is only shown when they agree, which is what the
 * empty `value` means.
 */
function AttributeSub({
  icon,
  label,
  value,
  onValueChange,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="gap-2.5">
        {icon}
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        <ContextMenuRadioGroup
          value={value}
          onValueChange={(next) => onValueChange(String(next))}
        >
          {children}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
