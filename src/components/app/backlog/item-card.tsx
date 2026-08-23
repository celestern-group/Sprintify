"use client";

import { IconCalendar } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import {
  describeEstimate,
  useItemEstimate,
} from "@/components/app/backlog/estimate-context";
import {
  PriorityMark,
  typeById,
  WorkItemTypeIcon,
} from "@/components/app/backlog/work-item-visuals";
import { UserGlimpse } from "@/components/app/user-glimpse";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { WorkItemRow, WorkItemTypeRow } from "@/lib/actions/work-items";
import { formatIsoShort } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/work-items";

/**
 * One work item as a board card. A real <button> rather than a click-handlered
 * div, so it is focusable and operable by keyboard even where dragging (a
 * mouse-only enhancement, as on the sprint timeline) is not.
 */
export function ItemCard({
  item,
  types,
  dragging = false,
  style,
  className,
  onOpen,
  dragHandleProps,
}: {
  item: WorkItemRow;
  types: WorkItemTypeRow[];
  dragging?: boolean;
  style?: CSSProperties;
  className?: string;
  onOpen: (item: WorkItemRow) => void;
  dragHandleProps?: Record<string, unknown>;
}) {
  const type = typeById(types, item.typeId);
  const estimate = useItemEstimate(item);

  return (
    <div
      style={style}
      className={cn(
        "rounded-lg border border-border bg-card p-3 shadow-card transition-shadow",
        dragging && "opacity-60",
        className,
      )}
      {...dragHandleProps}
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`Open ${item.key}`}
        className="flex w-full cursor-pointer flex-col gap-2 text-left"
      >
        {/* Identity line first — type, key, priority — so a column of cards
            scans like a list before any summary is read. */}
        <span className="flex items-center gap-1.5">
          <WorkItemTypeIcon type={type} />
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
            {item.key}
          </span>
          <PriorityMark priority={item.priority} className="ml-auto" />
        </span>
        <span className="line-clamp-3 text-sm font-semibold leading-snug">
          {item.summary}
        </span>
        {item.labels.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {item.labels.slice(0, 3).map((label) => (
              <span
                key={label}
                className="rounded-sm bg-chip px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
              >
                {label}
              </span>
            ))}
          </span>
        ) : null}
        {item.dueDate || estimate.value !== null || item.assigneeName ? (
          // Meta above a hairline — the StatCard footer pattern, at card scale.
          <span className="flex items-center gap-2 border-t border-border pt-2">
            {item.dueDate ? (
              <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                <IconCalendar className="size-3.5" aria-hidden />
                {formatIsoShort(item.dueDate)}
              </span>
            ) : null}
            {estimate.value !== null ? (
              // Muted when the number came from the children rather than from
              // this card — same distinction the list row draws.
              <span
                title={describeEstimate(estimate, "")}
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
            {item.assigneeName ? (
              // Hover-only (never a tab stop): this avatar lives INSIDE the
              // card's own button, so a focusable trigger would be a nested
              // button — invalid, and a second stop per card besides.
              <UserGlimpse
                className="ml-auto"
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
            ) : null}
          </span>
        ) : null}
        <span className="sr-only">
          {item.assigneeName
            ? `Assigned to ${item.assigneeName}.`
            : "Unassigned."}
        </span>
      </button>
    </div>
  );
}

/** The compact one-line form used by the backlog and table views. */
export function ItemRowIcons({
  item,
  types,
}: {
  item: WorkItemRow;
  types: WorkItemTypeRow[];
}) {
  const type = typeById(types, item.typeId);
  return (
    <span className="flex items-center gap-1.5">
      <WorkItemTypeIcon type={type} />
      <PriorityMark priority={item.priority} />
      {/* The key is an identifier people read and quote, not chrome — it sits
          at foreground ink, one step below the summary in size only. */}
      <span className="text-xs font-semibold tabular-nums text-foreground">
        {item.key}
      </span>
    </span>
  );
}
