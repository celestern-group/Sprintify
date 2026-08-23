import {
  type Icon,
  IconAlarm,
  IconClockExclamation,
  IconRuler2,
  IconUserQuestion,
} from "@tabler/icons-react";
import Link from "next/link";
import { WorkItemTypeIcon } from "@/components/app/backlog/work-item-visuals";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import type { WorkflowStatusCategory } from "@/db/schema/work-items";
import type {
  OverviewRecentItem,
  OverviewWorkloadRow,
  ProjectOverview,
} from "@/lib/actions/project-overview";
import { withReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";

const CATEGORY_BADGE: Record<
  WorkflowStatusCategory,
  "neutral" | "info" | "success"
> = {
  todo: "neutral",
  in_progress: "info",
  done: "success",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * Per-person open load: a two-segment bar (in progress + to do) scaled against
 * the busiest person, so the panel answers "who is carrying this sprint" at a
 * glance. The counts are printed beside it — the bar is decoration on top of
 * the numbers, never the only reading of them.
 */
export function WorkloadPanel({
  rows,
  overflow,
  unitLabel,
}: {
  rows: OverviewWorkloadRow[];
  overflow: number;
  unitLabel: string;
}) {
  const busiest = Math.max(1, ...rows.map((row) => row.todo + row.inProgress));

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing open right now — every item in the project sits in a done
        status.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const open = row.todo + row.inProgress;
          const share = (open / busiest) * 100;
          const progressShare = open > 0 ? (row.inProgress / open) * 100 : 0;
          return (
            <li
              key={row.memberId ?? "unassigned"}
              className="flex items-center gap-3"
            >
              {row.memberId ? (
                <Avatar size="sm">
                  {row.image ? <AvatarImage src={row.image} alt="" /> : null}
                  <AvatarFallback>{initials(row.name)}</AvatarFallback>
                </Avatar>
              ) : (
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <IconUserQuestion className="size-3.5" aria-hidden />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {open} open
                    {row.points > 0 ? ` · ${row.points}${unitLabel}` : ""}
                  </span>
                </div>
                <span
                  aria-hidden
                  className="flex h-1.5 overflow-hidden rounded-full bg-muted"
                  style={{ width: `${Math.max(6, share)}%` }}
                >
                  <span
                    className="block h-full bg-chart-2"
                    style={{ width: `${progressShare}%` }}
                  />
                  <span className="block h-full flex-1 bg-chart-1" />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {overflow > 0
          ? `${overflow} more ${overflow === 1 ? "person" : "people"} not shown. `
          : ""}
        Bar splits in progress (blue) from to do (violet).
      </p>
    </div>
  );
}

type AttentionRow = {
  icon: Icon;
  label: string;
  hint: string;
  count: number;
  tone: "danger" | "warning" | "neutral";
};

const ATTENTION_TONES: Record<AttentionRow["tone"], string> = {
  danger: "text-destructive",
  warning: "text-warning",
  neutral: "text-muted-foreground",
};

/**
 * The four questions a lead asks about an open backlog. Each row carries a
 * word as well as a colour, and a count of zero renders as a calm "none" line
 * rather than disappearing — a missing row reads as an unanswered question.
 */
export function AttentionPanel({ data }: { data: ProjectOverview }) {
  const rows: AttentionRow[] = [
    {
      icon: IconClockExclamation,
      label: "Overdue",
      hint: "Past their due date",
      count: data.overdue,
      tone: "danger",
    },
    {
      icon: IconAlarm,
      label: "Due this week",
      hint: "Due in the next 7 days",
      count: data.dueSoon,
      tone: "warning",
    },
    {
      icon: IconUserQuestion,
      label: "Unassigned",
      hint: "Open with nobody on them",
      count: data.unassigned,
      tone: "neutral",
    },
    {
      icon: IconRuler2,
      label: "Unestimated",
      hint: "Open with no estimate",
      count: data.unestimated,
      tone: "neutral",
    },
  ];

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md bg-chip",
              row.count > 0
                ? ATTENTION_TONES[row.tone]
                : "text-muted-foreground",
            )}
          >
            <row.icon className="size-4" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{row.label}</span>
            <span className="truncate text-xs text-muted-foreground">
              {row.hint}
            </span>
          </span>
          <span
            className={cn(
              "ml-auto text-lg font-extrabold tabular-nums",
              row.count > 0
                ? ATTENTION_TONES[row.tone]
                : "text-muted-foreground",
            )}
          >
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The project's pulse — what moved most recently, newest first. */
export function RecentItems({
  items,
  basePath,
}: {
  items: OverviewRecentItem[];
  basePath: string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has moved yet. Items show up here as soon as someone creates or
        updates one.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <WorkItemTypeIcon
            type={{
              icon: item.typeIcon,
              tone: item.typeTone,
              name: item.typeName,
            }}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <Link
              // This panel only ever renders on the project overview, so the
              // overview IS the origin — no hook needed in a server component.
              href={withReturnTo(`${basePath}/backlog/${item.key}`, basePath)}
              className="truncate text-sm font-semibold hover:underline"
            >
              {item.summary}
            </Link>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{item.key}</span>
              <span aria-hidden>·</span>
              <RelativeTime date={item.updatedAt} />
              {item.assigneeName ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{item.assigneeName}</span>
                </>
              ) : null}
            </span>
          </div>
          <Badge
            variant={CATEGORY_BADGE[item.statusCategory]}
            className="hidden shrink-0 sm:inline-flex"
          >
            {item.statusName}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Status mix under the donut — the chart's data-table fallback. */
export function StatusLegend({
  rows,
  total,
}: {
  rows: {
    id: string;
    name: string;
    category: WorkflowStatusCategory;
    count: number;
  }[];
  total: number;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              row.category === "done"
                ? "bg-chart-3"
                : row.category === "in_progress"
                  ? "bg-chart-2"
                  : "bg-chart-1",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {row.count}
            {total > 0 ? ` · ${Math.round((row.count / total) * 100)}%` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
