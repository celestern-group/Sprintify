"use client";

import { IconSelector } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
};

/**
 * A filter that takes several values at once — the toolbar counterpart to
 * `NativeSelect`, which can only ever ask "which one".
 *
 * It reads as a select (same height, border and chevron) so a row of them
 * lines up with the other controls, but selection is a checkbox list that
 * stays open while you tick, and the trigger fills with the violet tint once
 * anything is chosen — the v0.3 "filled selection, not an edge" rule, which is
 * also what tells you at a glance that a view is narrowed.
 *
 * Empty selection means "everything": callers filter with
 * `values.length === 0 || values.includes(...)` rather than seeding the array
 * with every option, so a newly added type/sprint is visible by default
 * instead of silently excluded.
 */
export function MultiSelectFilter({
  ariaLabel,
  className,
  emptyLabel,
  onValueChange,
  options,
  values,
}: {
  /** Names the control for screen readers, e.g. "Filter by type". */
  ariaLabel: string;
  className?: string;
  /** What the trigger says when nothing is selected, e.g. "All types". */
  emptyLabel: string;
  onValueChange: (next: string[]) => void;
  options: MultiSelectOption[];
  values: string[];
}) {
  const selected = new Set(values);
  const chosen = options.filter((option) => selected.has(option.value));
  const active = chosen.length > 0;

  // One name plus a count, never a comma-joined list: the trigger sits in a
  // wrapping toolbar and has to keep a bounded width at 375px.
  const summary = !active
    ? emptyLabel
    : chosen.length === 1
      ? chosen[0].label
      : `${chosen[0].label} +${chosen.length - 1}`;

  function toggle(value: string, checked: boolean) {
    onValueChange(
      checked
        ? [...values.filter((entry) => entry !== value), value]
        : values.filter((entry) => entry !== value),
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${ariaLabel}${active ? `, ${chosen.length} selected` : ""}`}
        className={cn(
          "flex h-8 w-fit min-w-0 max-w-52 shrink-0 items-center gap-2 rounded-md border py-1 pr-2.5 pl-3 text-sm transition-[color,box-shadow,background-color] outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
          active
            ? "border-transparent bg-secondary font-semibold text-secondary-foreground"
            : "border-input bg-transparent",
          className,
        )}
      >
        <span className="min-w-0 truncate">{summary}</span>
        <IconSelector
          className={cn(
            "size-4 shrink-0",
            active ? "text-secondary-foreground" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 min-w-(--anchor-width)">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            indicator="checkbox"
            onCheckedChange={(checked) => toggle(option.value, checked)}
          >
            <span className="min-w-0 truncate">{option.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onValueChange([])}>
              Clear
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
