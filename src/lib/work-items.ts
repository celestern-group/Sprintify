// Shared, client-safe vocabulary for the backlog layer.
//
// No db/server imports: the type editor, the board and the server actions all
// need the same definition of what an icon name, a rank position or a seed
// catalog is. Mirrors src/lib/project-permissions.ts — data lives in tables,
// the rules about that data live here.

import type {
  WorkflowStatusCategory,
  WorkItemHierarchyLevel,
  WorkItemTone,
} from "@/db/schema/work-items";

/**
 * The Tabler icons a work item type may use. An allow-list, not free text: the
 * value is resolved through a map at render time, so a synced type carrying
 * "IconWhatever" degrades to the fallback instead of breaking the board.
 */
export const WORK_ITEM_ICONS = [
  "IconFile",
  "IconBookmark",
  "IconBug",
  "IconCheckbox",
  "IconSubtask",
  "IconFlag",
  "IconBolt",
  "IconTargetArrow",
  "IconSparkles",
  "IconTool",
  "IconAlertTriangle",
  "IconNotes",
] as const;

export type WorkItemIconName = (typeof WORK_ITEM_ICONS)[number];

export const DEFAULT_WORK_ITEM_ICON: WorkItemIconName = "IconFile";

export function isWorkItemIcon(value: unknown): value is WorkItemIconName {
  return (
    typeof value === "string" &&
    (WORK_ITEM_ICONS as readonly string[]).includes(value)
  );
}

/** The human reference for an item — PROJ-123. Never stored, always composed. */
export function workItemKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

/** Same rule as slugifyRoleKey: the server always re-derives, never trusts. */
export function slugifyTypeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Whether `parent` may sit above `child` in the tree. Levels, not names.
 *
 * `strict` is the CHILD type's `strictHierarchy` — the question being asked is
 * "where may this item live", so the item being placed is what decides. Strict
 * demands a strictly higher parent (a lower number). Non-strict skips the
 * level rule entirely: the item drops
 * anywhere, including under its own level or below it.
 *
 * Only the LEVEL rule relaxes. Self-parenting and cycles are refused either
 * way, by the callers — those would make the tree views recurse forever.
 */
export function canParent(
  parentLevel: number,
  childLevel: number,
  strict = true,
): boolean {
  return strict ? parentLevel < childLevel : true;
}

export const SEED_WORK_ITEM_TYPES: readonly {
  key: string;
  name: string;
  description: string;
  hierarchyLevel: WorkItemHierarchyLevel;
  tone: WorkItemTone;
  icon: WorkItemIconName;
  isDefault: boolean;
  tracksDefect: boolean;
  position: number;
}[] = [
  {
    key: "epic",
    name: "Epic",
    description: "A large body of work that spans sprints and holds features.",
    hierarchyLevel: 0,
    tone: "brand",
    icon: "IconBolt",
    isDefault: false,
    tracksDefect: false,
    position: 0,
  },
  {
    key: "feature",
    name: "Feature",
    description:
      "A shippable capability inside an epic, delivered as a set of stories.",
    hierarchyLevel: 1,
    tone: "amber",
    icon: "IconFlag",
    isDefault: false,
    tracksDefect: false,
    position: 1,
  },
  {
    key: "story",
    name: "Story",
    description:
      "A user-facing change, described from the user's point of view.",
    hierarchyLevel: 2,
    tone: "success",
    icon: "IconBookmark",
    isDefault: true,
    tracksDefect: false,
    position: 2,
  },
  {
    key: "task",
    name: "Task",
    description: "A piece of work that isn't expressed as a user story.",
    hierarchyLevel: 3,
    tone: "blue",
    icon: "IconCheckbox",
    isDefault: false,
    tracksDefect: false,
    position: 3,
  },
  {
    key: "bug",
    name: "Bug",
    description: "Something behaving differently from how it should.",
    hierarchyLevel: 4,
    tone: "danger",
    icon: "IconBug",
    isDefault: false,
    // The defect type out of the box: steps to reproduce, expected, actual.
    tracksDefect: true,
    position: 4,
  },
  {
    key: "subtask",
    name: "Sub-task",
    description: "A slice of a story or task, tracked under its parent.",
    hierarchyLevel: 5,
    tone: "neutral",
    icon: "IconSubtask",
    isDefault: false,
    tracksDefect: false,
    position: 5,
  },
];

export const SEED_WORKFLOW_STATUSES: readonly {
  name: string;
  description: string;
  category: WorkflowStatusCategory;
  position: number;
  isDefault: boolean;
}[] = [
  {
    name: "To do",
    description: "Accepted into the sprint, not started.",
    category: "todo",
    position: 0,
    isDefault: true,
  },
  {
    name: "In progress",
    description: "Someone is actively working on it.",
    category: "in_progress",
    position: 1,
    isDefault: false,
  },
  {
    name: "In review",
    description: "Work is done and waiting on review.",
    category: "in_progress",
    position: 2,
    isDefault: false,
  },
  {
    name: "Done",
    description: "Finished and accepted.",
    category: "done",
    position: 3,
    isDefault: false,
  },
];

/** The views the backlog page can render. `view` is a URL search param. */
export const BACKLOG_VIEWS = ["backlog", "board", "table", "timeline"] as const;
export type BacklogView = (typeof BACKLOG_VIEWS)[number];

export const BACKLOG_VIEW_LABELS: Record<BacklogView, string> = {
  backlog: "Backlog",
  board: "Board",
  table: "Table",
  timeline: "Timeline",
};

export function isBacklogView(value: unknown): value is BacklogView {
  return (
    typeof value === "string" &&
    (BACKLOG_VIEWS as readonly string[]).includes(value)
  );
}

/** Tailwind classes per tone, so a type's colour never escapes the palette.
    TEXT colour only — a work item type is a bare coloured glyph, not a filled
    tile. The tile was tried both ways (12% tint, then solid + white icon) and
    neither survived a dense row: the tint vanished at 20px square, and a
    column of solid squares turned the backlog into a colour chart. An
    uncontained icon at full ink strength is what reads sharp. */
export const WORK_ITEM_TONE_CLASSES: Record<WorkItemTone, string> = {
  brand: "text-brand",
  blue: "text-chart-2",
  success: "text-success",
  amber: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

export const WORKFLOW_CATEGORY_CLASSES: Record<WorkflowStatusCategory, string> =
  {
    todo: "text-muted-foreground",
    in_progress: "text-chart-2",
    done: "text-success",
  };

/**
 * The icon-square treatment for a category, where a surface IS wanted (a
 * settings row, not a dense list). Neutral square, coloured glyph — same rule
 * as the chips: the surface never takes the hue. Lives here rather than beside
 * the icons because server components read it — a plain object exported from a
 * "use client" module comes back as a module reference, not the value.
 */
export const WORKFLOW_CATEGORY_TILE_CLASSES: Record<
  WorkflowStatusCategory,
  string
> = {
  todo: "bg-chip text-muted-foreground",
  in_progress: "bg-chip text-chart-2",
  done: "bg-chip text-success",
};

/** Up to two initials for an avatar fallback. Server-safe, so a server
    component can render an assignee square without a client boundary. */
export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Priority ordering for sorts — highest first. */
export const PRIORITY_WEIGHT: Record<string, number> = {
  highest: 4,
  high: 3,
  medium: 2,
  low: 1,
  lowest: 0,
};
