"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  sprint,
  user,
  workflowStatus,
  workItem,
  workItemType,
} from "@/db/schema";
import type {
  WorkflowStatusCategory,
  WorkItemTone,
} from "@/db/schema/work-items";
import { addDaysIso, todayIso } from "@/lib/date-only";
import {
  bucketEstimates,
  effectiveEstimates,
  sumEstimates,
} from "@/lib/estimate-rollup";
import { requireProjectPermission } from "@/lib/project-access";
import { loadProjectOrThrow } from "@/lib/work-item-access";
import { workItemKey } from "@/lib/work-items";

// The project overview's read path.
//
// One lean select of every item in the project, aggregated in TypeScript, in
// place of a dozen grouped queries. A dashboard asks eight questions of the
// same rows (how many per status, per type, per assignee, how many overdue,
// what shipped each week) — eight round trips would each re-scan the same
// index for a project whose backlog the board already loads whole. What this
// read deliberately does NOT do is pull prose: no description, no custom field
// values, nothing the summary strip can't show.

const VIEW_DENIED = "You don't have permission to view this project's backlog.";
const ORG_BYPASS: Record<string, string[]> = { project: ["update"] };

/** Weeks of history the flow chart shows. */
const FLOW_WEEKS = 8;
/** How far ahead "due soon" looks. */
const DUE_SOON_DAYS = 7;
/** People shown in the workload panel before it stops listing. */
const WORKLOAD_LIMIT = 6;
/** Items in the "recently updated" stream. */
const RECENT_LIMIT = 6;

export type OverviewCategoryCount = {
  category: WorkflowStatusCategory;
  count: number;
  points: number;
};

export type OverviewStatusSlice = {
  id: string;
  name: string;
  category: WorkflowStatusCategory;
  count: number;
};

export type OverviewTypeSlice = {
  id: string;
  name: string;
  tone: WorkItemTone;
  icon: string;
  count: number;
};

export type OverviewWorkloadRow = {
  /** Null is the unassigned bucket — a real row, not a missing one. */
  memberId: string | null;
  name: string;
  image: string | null;
  todo: number;
  inProgress: number;
  points: number;
};

export type OverviewFlowPoint = {
  /** Week start, ISO — the x-axis key and the tooltip's anchor. */
  weekStart: string;
  label: string;
  created: number;
  completed: number;
};

export type OverviewRecentItem = {
  id: string;
  key: string;
  summary: string;
  typeName: string;
  typeIcon: string;
  typeTone: WorkItemTone;
  statusName: string;
  statusCategory: WorkflowStatusCategory;
  assigneeName: string | null;
  assigneeImage: string | null;
  updatedAt: Date;
};

export type OverviewSprintScope = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  items: number;
  done: number;
  points: number;
  donePoints: number;
  actualEfforts: number;
  burnDown: OverviewBurnDownPoint[];
};

export type OverviewBurnDownPoint = {
  date: string;
  label: string;
  remaining: number;
  ideal: number;
};

export type ProjectOverview = {
  total: number;
  byCategory: Record<WorkflowStatusCategory, OverviewCategoryCount>;
  statuses: OverviewStatusSlice[];
  types: OverviewTypeSlice[];
  workload: OverviewWorkloadRow[];
  /** Assignees past WORKLOAD_LIMIT — the panel says so rather than hiding it. */
  workloadOverflow: number;
  flow: OverviewFlowPoint[];
  recent: OverviewRecentItem[];
  /** Open = anything not in a done-category status. */
  overdue: number;
  dueSoon: number;
  unassigned: number;
  unestimated: number;
  createdLast7: number;
  completedLast7: number;
  completedPrev7: number;
  /** Scope of the active sprint, when there is one. */
  sprintScope: OverviewSprintScope | null;
};

/** Monday-anchored week start, in UTC, as an ISO date. */
function weekStartIso(value: Date): string {
  const day = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  // getUTCDay() is Sunday-first; shift so Monday is 0.
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function weekLabel(iso: string): string {
  const [, month, day] = iso.split("-");
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getProjectOverview(input: {
  organizationId: string;
  projectId: string;
}): Promise<ProjectOverview> {
  await requireProjectPermission(
    input.organizationId,
    input.projectId,
    "backlog:view",
    ORG_BYPASS,
    VIEW_DENIED,
  );

  const { key: projectKey } = await loadProjectOrThrow(input.projectId);

  const [rows, activeSprint] = await Promise.all([
    db
      .select({
        id: workItem.id,
        number: workItem.number,
        summary: workItem.summary,
        points: workItem.points,
        actualEfforts: workItem.actualEfforts,
        // Rides along for the estimate roll-up: a parent's number comes from
        // its children (see `effectiveEstimates`).
        parentId: workItem.parentId,
        dueDate: workItem.dueDate,
        sprintId: workItem.sprintId,
        completedAt: workItem.completedAt,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt,
        statusId: workflowStatus.id,
        statusName: workflowStatus.name,
        statusCategory: workflowStatus.category,
        statusPosition: workflowStatus.position,
        typeId: workItemType.id,
        typeName: workItemType.name,
        typeTone: workItemType.tone,
        typeIcon: workItemType.icon,
        typePosition: workItemType.position,
        assigneeMemberId: workItem.assigneeMemberId,
        assigneeName: user.name,
        assigneeImage: user.image,
      })
      .from(workItem)
      .innerJoin(workflowStatus, eq(workItem.statusId, workflowStatus.id))
      .innerJoin(workItemType, eq(workItem.typeId, workItemType.id))
      .leftJoin(member, eq(workItem.assigneeMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(eq(workItem.projectId, input.projectId))
      .orderBy(desc(workItem.updatedAt)),
    db
      .select({
        id: sprint.id,
        name: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      })
      .from(sprint)
      .where(
        and(eq(sprint.projectId, input.projectId), eq(sprint.state, "active")),
      )
      .orderBy(asc(sprint.startDate))
      .limit(1),
  ]);

  // One roll-up pass over the project: an item with no `points` of its own
  // still has an estimate if anything is broken out under it.
  const estimates = effectiveEstimates(rows);

  const today = todayIso();
  const dueSoonCutoff = addDaysIso(today, DUE_SOON_DAYS);
  const last7 = daysAgo(7);
  const prev7 = daysAgo(14);

  const byCategory: Record<WorkflowStatusCategory, OverviewCategoryCount> = {
    todo: { category: "todo", count: 0, points: 0 },
    in_progress: { category: "in_progress", count: 0, points: 0 },
    done: { category: "done", count: 0, points: 0 },
  };

  const statuses = new Map<
    string,
    OverviewStatusSlice & { position: number }
  >();
  const types = new Map<string, OverviewTypeSlice & { position: number }>();
  const workload = new Map<string, OverviewWorkloadRow>();
  const flow = new Map<string, OverviewFlowPoint>();

  // Empty buckets first, so a quiet week is a zero on the chart rather than a
  // gap the line skips over.
  for (let index = FLOW_WEEKS - 1; index >= 0; index -= 1) {
    const start = weekStartIso(daysAgo(index * 7));
    flow.set(start, {
      weekStart: start,
      label: weekLabel(start),
      created: 0,
      completed: 0,
    });
  }
  const flowFloor = [...flow.keys()][0] ?? weekStartIso(new Date());

  let overdue = 0;
  let dueSoon = 0;
  let unassigned = 0;
  let unestimated = 0;
  let createdLast7 = 0;
  let completedLast7 = 0;
  let completedPrev7 = 0;

  const sprintScope: OverviewSprintScope | null = activeSprint[0]
    ? {
        id: activeSprint[0].id,
        name: activeSprint[0].name,
        startDate: activeSprint[0].startDate,
        endDate: activeSprint[0].endDate,
        items: 0,
        done: 0,
        points: 0,
        donePoints: 0,
        actualEfforts: 0,
        burnDown: [],
      }
    : null;

  // Counts accumulate row by row; POINT totals do not — they are summed per set
  // after the loop, because a parent's estimate already covers its children and
  // adding both would report the same work twice (see `sumEstimates`).
  for (const row of rows) {
    const open = row.statusCategory !== "done";

    const bucket = byCategory[row.statusCategory];
    bucket.count += 1;

    const status = statuses.get(row.statusId);
    if (status) status.count += 1;
    else
      statuses.set(row.statusId, {
        id: row.statusId,
        name: row.statusName,
        category: row.statusCategory,
        count: 1,
        position: row.statusPosition,
      });

    const type = types.get(row.typeId);
    if (type) type.count += 1;
    else
      types.set(row.typeId, {
        id: row.typeId,
        name: row.typeName,
        tone: row.typeTone,
        icon: row.typeIcon,
        count: 1,
        position: row.typePosition,
      });

    if (open) {
      const key = row.assigneeMemberId ?? "";
      const load = workload.get(key);
      if (load) {
        if (row.statusCategory === "in_progress") load.inProgress += 1;
        else load.todo += 1;
      } else {
        workload.set(key, {
          memberId: row.assigneeMemberId,
          name: row.assigneeName ?? "Unassigned",
          image: row.assigneeImage,
          todo: row.statusCategory === "in_progress" ? 0 : 1,
          inProgress: row.statusCategory === "in_progress" ? 1 : 0,
          points: 0,
        });
      }

      if (!row.assigneeMemberId) unassigned += 1;
      // A parent whose children are sized is NOT unestimated — nagging about
      // an epic that is fully broken down is exactly what the roll-up removes.
      if ((estimates.get(row.id)?.value ?? null) === null) unestimated += 1;
      if (row.dueDate) {
        if (row.dueDate < today) overdue += 1;
        else if (row.dueDate <= dueSoonCutoff) dueSoon += 1;
      }
    }

    const createdWeek = weekStartIso(row.createdAt);
    if (createdWeek >= flowFloor) {
      const point = flow.get(createdWeek);
      if (point) point.created += 1;
    }
    if (row.createdAt >= last7) createdLast7 += 1;

    if (row.completedAt) {
      const completedWeek = weekStartIso(row.completedAt);
      if (completedWeek >= flowFloor) {
        const point = flow.get(completedWeek);
        if (point) point.completed += 1;
      }
      if (row.completedAt >= last7) completedLast7 += 1;
      else if (row.completedAt >= prev7) completedPrev7 += 1;
    }

    if (sprintScope && row.sprintId === sprintScope.id) {
      sprintScope.items += 1;
      if (row.statusCategory === "done") sprintScope.done += 1;
    }
  }

  // Every breakdown splits ONE total with `bucketEstimates` rather than calling
  // `sumEstimates` per bucket: a parent's roll-up already covers its children,
  // so a parent in progress over a done child would be counted in both columns
  // and the bars would out-total the project (see `attributeEstimates`).
  const byCategoryPoints = bucketEstimates(
    rows,
    (row) => row.statusCategory,
    rows,
    estimates,
  );
  for (const bucket of Object.values(byCategory)) {
    bucket.points = byCategoryPoints.get(bucket.category) ?? 0;
  }

  const openRows = rows.filter((row) => row.statusCategory !== "done");
  const workloadPoints = bucketEstimates(
    openRows,
    (row) => row.assigneeMemberId ?? "",
    rows,
    estimates,
  );
  for (const [key, load] of workload) {
    load.points = workloadPoints.get(key) ?? 0;
  }

  if (sprintScope) {
    const scopeId = sprintScope.id;
    const sprintRows = rows.filter((row) => row.sprintId === scopeId);
    sprintScope.points = sumEstimates(sprintRows, rows, estimates);
    // Done vs not is a split of the sprint's own total, so the burn-down half
    // can never exceed the whole.
    sprintScope.donePoints =
      bucketEstimates(
        sprintRows,
        (row) => (row.statusCategory === "done" ? "done" : "open"),
        rows,
        estimates,
      ).get("done") ?? 0;
    sprintScope.actualEfforts = sprintRows.reduce(
      (sum, row) => sum + (row.actualEfforts ?? 0),
      0,
    );

    // This is a current-scope chart: completion timestamps accurately show
    // burn, while historic scope changes are intentionally not fabricated.
    const chartEnd = sprintScope.endDate < today ? sprintScope.endDate : today;
    const totalDays = Math.max(
      1,
      Math.round(
        (Date.parse(`${sprintScope.endDate}T00:00:00Z`) -
          Date.parse(`${sprintScope.startDate}T00:00:00Z`)) /
          86_400_000,
      ),
    );
    for (
      let date = sprintScope.startDate;
      date <= chartEnd;
      date = addDaysIso(date, 1)
    ) {
      const doneByDate =
        bucketEstimates(
          sprintRows.filter(
            (row) =>
              row.completedAt &&
              row.completedAt.toISOString().slice(0, 10) <= date,
          ),
          () => "done",
          sprintRows,
          estimates,
        ).get("done") ?? 0;
      const elapsed = Math.round(
        (Date.parse(`${date}T00:00:00Z`) -
          Date.parse(`${sprintScope.startDate}T00:00:00Z`)) /
          86_400_000,
      );
      sprintScope.burnDown.push({
        date,
        label: date.slice(8),
        remaining: Math.max(0, sprintScope.points - doneByDate),
        ideal: Math.max(0, sprintScope.points * (1 - elapsed / totalDays)),
      });
    }
  }

  // Heaviest load first — the panel exists to show where work is piling up,
  // and the unassigned bucket sorts by the same rule as everyone else.
  const workloadRows = [...workload.values()].sort(
    (a, b) => b.todo + b.inProgress - (a.todo + a.inProgress),
  );

  return {
    total: rows.length,
    byCategory,
    statuses: [...statuses.values()]
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map(({ position: _position, ...slice }) => slice),
    types: [...types.values()]
      .sort((a, b) => b.count - a.count || a.position - b.position)
      .map(({ position: _position, ...slice }) => slice),
    workload: workloadRows.slice(0, WORKLOAD_LIMIT),
    workloadOverflow: Math.max(0, workloadRows.length - WORKLOAD_LIMIT),
    flow: [...flow.values()],
    recent: rows.slice(0, RECENT_LIMIT).map((row) => ({
      id: row.id,
      key: workItemKey(projectKey, row.number),
      summary: row.summary,
      typeName: row.typeName,
      typeIcon: row.typeIcon,
      typeTone: row.typeTone,
      statusName: row.statusName,
      statusCategory: row.statusCategory,
      assigneeName: row.assigneeName,
      assigneeImage: row.assigneeImage,
      updatedAt: row.updatedAt,
    })),
    overdue,
    dueSoon,
    unassigned,
    unestimated,
    createdLast7,
    completedLast7,
    completedPrev7,
    sprintScope,
  };
}
