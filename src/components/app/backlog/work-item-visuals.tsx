"use client";

import {
  IconAlertHexagon,
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconBookmark,
  IconBug,
  IconCheckbox,
  IconCircleCheck,
  IconCircleDashed,
  IconEqual,
  IconFile,
  IconFlag,
  IconNotes,
  IconProgress,
  IconSparkles,
  IconSubtask,
  IconTag,
  IconTargetArrow,
  IconTool,
  IconTrendingUp,
} from "@tabler/icons-react";
import type {
  WorkflowStatusCategory,
  WorkItemPriority,
  WorkItemTone,
  WorkItemValueLevel,
} from "@/db/schema/work-items";
import {
  WORK_ITEM_PRIORITY_LABELS,
  WORK_ITEM_VALUE_LABELS,
} from "@/db/schema/work-items";
import type { WorkItemTypeRow } from "@/lib/actions/work-items";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WORK_ITEM_ICON,
  WORK_ITEM_TONE_CLASSES,
  WORKFLOW_CATEGORY_CLASSES,
} from "@/lib/work-items";

// The one place a stored icon name becomes a component. A synced type carrying
// an icon we've never heard of falls back rather than breaking the board, which
// is why the column is a name and never markup.
const ICONS = {
  IconFile,
  IconBookmark,
  IconBug,
  IconCheckbox,
  IconSubtask,
  IconFlag,
  IconBolt,
  IconTargetArrow,
  IconSparkles,
  IconTool,
  IconAlertTriangle,
  IconNotes,
} as const;

export function WorkItemTypeIcon({
  type,
  className,
}: {
  type: { icon: string; tone: WorkItemTone; name: string };
  className?: string;
}) {
  const Icon =
    ICONS[type.icon as keyof typeof ICONS] ?? ICONS[DEFAULT_WORK_ITEM_ICON];
  return (
    <span
      className={cn(
        "grid size-5 shrink-0 place-items-center",
        WORK_ITEM_TONE_CLASSES[type.tone],
        className,
      )}
      title={type.name}
    >
      <Icon className="size-4.5" stroke={1.9} aria-hidden />
      <span className="sr-only">{type.name}</span>
    </span>
  );
}

// Priority never rides on colour alone (AA: colour is never the only signal) —
// each level carries its own arrow shape and a text label in the tooltip.
// Exported so the sidebar pickers can render the same arrow beside each option.
export const PRIORITY_META: Record<
  WorkItemPriority,
  { icon: typeof IconArrowUp; className: string; label: string }
> = {
  highest: {
    // Ember, not magenta — magenta stays reserved for destructive actions.
    icon: IconArrowUp,
    className: "text-critical",
    label: "Highest priority",
  },
  high: {
    icon: IconArrowUp,
    className: "text-warning",
    label: "High priority",
  },
  medium: {
    icon: IconEqual,
    className: "text-muted-foreground",
    label: "Medium priority",
  },
  low: {
    icon: IconArrowDown,
    className: "text-chart-2",
    label: "Low priority",
  },
  lowest: {
    icon: IconArrowDown,
    className: "text-muted-foreground",
    label: "Lowest priority",
  },
};

export function PriorityMark({
  priority,
  className,
}: {
  priority: WorkItemPriority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center", meta.className, className)}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/**
 * The shared chip shell — neutral surface, ink label, one coloured glyph.
 * Every chip below is this plus an icon; see badge.tsx for why colour never
 * fills the surface. The label sits in `--foreground`, not a muted grey: the
 * hue is the *mark's* job, so the text is free to be at full strength.
 */
const CHIP =
  "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-sm bg-chip px-2.5 text-[11px] font-semibold text-foreground";

/** Status: category glyph in category colour + the workflow's own name. */
export function StatusChip({
  name,
  category,
  className,
}: {
  name: string;
  category: WorkflowStatusCategory;
  className?: string;
}) {
  // "To do" is deliberately neutral — it is the absence of progress, and
  // spending a hue on it would leave nothing to distinguish the states that
  // matter. The dashed-ring glyph still separates it from the others.
  const Icon = STATUS_CATEGORY_ICONS[category];
  return (
    <span className={cn(CHIP, className)}>
      <Icon
        className={cn("size-3.5 shrink-0", WORKFLOW_CATEGORY_CLASSES[category])}
        aria-hidden
      />
      {name}
    </span>
  );
}

/**
 * The icon a workflow category wears outside a lozenge. Shapes differ per
 * category (dashed ring / half-filled dial / tick) so the state still reads
 * under colour-vision deficiency. Kept private and reached through the
 * component below — a bare object exported from this "use client" module would
 * arrive at a server component as a module reference rather than the value.
 */
const STATUS_CATEGORY_ICONS: Record<
  WorkflowStatusCategory,
  typeof IconCircleDashed
> = {
  todo: IconCircleDashed,
  in_progress: IconProgress,
  done: IconCircleCheck,
};

export function StatusCategoryIcon({
  category,
  className,
}: {
  category: WorkflowStatusCategory;
  className?: string;
}) {
  const Icon = STATUS_CATEGORY_ICONS[category];
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

// Priority as a lozenge rather than a bare arrow — the detail page has room for
// the word, and the arrow still carries the level under colour-vision
// deficiency. Magenta stays reserved for destructive, so "highest" takes ember.
// Colour lives on the arrow only; PRIORITY_META already owns those classes.
export function PriorityChip({
  priority,
  className,
}: {
  priority: WorkItemPriority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  return (
    <span className={cn(CHIP, className)}>
      <Icon
        className={cn("size-3.5 shrink-0", meta.className)}
        stroke={2.2}
        aria-hidden
      />
      {WORK_ITEM_PRIORITY_LABELS[priority]}
    </span>
  );
}

// Value and risk share one four-step scale, so they share one fill ramp; the
// icon is what says which dimension you're reading. Exported for the pickers.
export const VALUE_LEVEL_CLASSES: Record<WorkItemValueLevel, string> = {
  low: "text-muted-foreground",
  medium: "text-chart-2",
  high: "text-warning",
  critical: "text-critical",
};

export function ValueChip({
  level,
  kind,
  className,
}: {
  level: WorkItemValueLevel;
  kind: "value" | "risk";
  className?: string;
}) {
  const Icon = kind === "value" ? IconTrendingUp : IconAlertHexagon;
  return (
    <span className={cn(CHIP, className)}>
      <Icon
        className={cn("size-3.5 shrink-0", VALUE_LEVEL_CLASSES[level])}
        aria-hidden
      />
      <span className="sr-only">
        {kind === "value" ? "Business value" : "Risk"}:{" "}
      </span>
      {WORK_ITEM_VALUE_LABELS[level]}
    </span>
  );
}

/** A free-text label. Neutral on purpose — colour here is authored, not meant. */
export function LabelChip({ label }: { label: string }) {
  return (
    <span className={cn(CHIP, "min-w-0")}>
      <IconTag className="size-3.5 shrink-0 text-brand" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function typeById(types: WorkItemTypeRow[], id: string) {
  return (
    types.find((type) => type.id === id) ?? {
      id,
      key: "unknown",
      name: "Unknown",
      description: null,
      hierarchyLevel: 1,
      tone: "neutral" as WorkItemTone,
      icon: DEFAULT_WORK_ITEM_ICON,
      isDefault: false,
      position: 0,
    }
  );
}
