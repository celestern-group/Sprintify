"use client";

import {
  IconLayoutKanban,
  IconList,
  IconPlus,
  IconRocket,
  IconSitemap,
  IconSparkles,
  IconTable,
  IconTimeline,
} from "@tabler/icons-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BacklogListView } from "@/components/app/backlog/backlog-list-view";
import { BoardView } from "@/components/app/backlog/board-view";
import { EstimateProvider } from "@/components/app/backlog/estimate-context";
import type { BacklogMenuContext } from "@/components/app/backlog/item-context-menu";
import { useItemSelection } from "@/components/app/backlog/selection";
import { TableView } from "@/components/app/backlog/table-view";
import type {
  AttributesPayload,
  BacklogGrouping,
  ComposerSeed,
  FilterableRow,
  MoveItemsPayload,
  MovePayload,
} from "@/components/app/backlog/types";
import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { PreferenceScopeProvider } from "@/components/preferences/preference-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { toast } from "@/components/ui/toast";
import {
  reviveStringArray,
  usePersistedChoice,
  usePersistedFlag,
  usePersistedState,
} from "@/hooks/use-persisted-state";
import { useReturnToHref } from "@/hooks/use-return-to";
import { searchWorkItemsByMeaning } from "@/lib/actions/ai-assist";
import type { BacklogData, WorkItemRow } from "@/lib/actions/work-items";
import {
  createWorkItem,
  moveWorkItem,
  moveWorkItems,
  setWorkItemAttributes,
  setWorkItemParent,
} from "@/lib/actions/work-items";
import { trackEvent } from "@/lib/analytics";
import { countUnestimated, sumEstimates } from "@/lib/estimate-rollup";
import { between } from "@/lib/rank";
import { withReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";
import {
  BACKLOG_VIEW_LABELS,
  BACKLOG_VIEWS,
  type BacklogView,
} from "@/lib/work-items";

/** Both grouping postures, as a value — the reviver needs the set at runtime. */
const BACKLOG_GROUPINGS: readonly BacklogGrouping[] = ["none", "sprint"];

/** Shared "no filter" identity, so a restore-miss doesn't mint a new array. */
const EMPTY_FILTER: string[] = [];

// The composer brings the TipTap editors (and everything the item form's prose
// blocks bring with them) for a card most backlog opens never unfold, so it
// loads on the first "New item" click instead of with the list.
const InlineItemComposer = dynamic(
  () =>
    import("@/components/app/backlog/inline-composer").then(
      (mod) => mod.InlineItemComposer,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-64 animate-pulse rounded-lg border border-border bg-muted"
        aria-hidden
      />
    ),
  },
);

// The Gantt drags in jotai, dnd-kit and date-fns; it is only one of four views,
// so it loads when that view is chosen rather than on every backlog open.
const TimelineView = dynamic(
  () =>
    import("@/components/app/backlog/timeline-view").then(
      (mod) => mod.TimelineView,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full min-h-0 animate-pulse rounded-lg border border-border bg-muted"
        aria-hidden
      />
    ),
  },
);

/** Where every item stands in the flow. Colour marks the segments, but the
    legend rows carry the words and counts — the bar is never the only signal. */
const DISTRIBUTION_SEGMENTS = [
  { key: "done", label: "Done", bar: "bg-success", dot: "bg-success" },
  {
    key: "in_progress",
    label: "In progress",
    bar: "bg-chart-2",
    dot: "bg-chart-2",
  },
  {
    key: "todo",
    label: "To do",
    bar: "bg-muted-foreground/30",
    dot: "bg-muted-foreground/50",
  },
] as const;

type StatusCounts = Record<"todo" | "in_progress" | "done", number>;

/**
 * Semicircle gauge with the delivered share at its centre — the v0.3 "charts
 * are heroes" pattern, same construction as the sprint CapacityGauge but
 * reading "done out of everything" rather than "committed against capacity".
 * The exact counts are printed in the legend beneath it, so the arc is never
 * the only way to read the number.
 */
function DeliveryGauge({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? done / total : 0;
  const percent = Math.round(ratio * 100);
  const radius = 68;
  const circumference = Math.PI * radius;
  const dash = circumference * ratio;
  const label = `${done} of ${total} items delivered, ${percent} percent`;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 160 90"
        className="h-[90px] w-[160px]"
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <path
          d="M 12 80 A 68 68 0 0 1 148 80"
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className="stroke-muted"
        />
        <path
          d="M 12 80 A 68 68 0 0 1 148 80"
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="stroke-primary transition-[stroke-dasharray] duration-400 ease-out motion-reduce:transition-none"
        />
        <text
          x="80"
          y="70"
          textAnchor="middle"
          className="fill-foreground text-[26px] font-extrabold tabular-nums"
        >
          {percent}%
        </text>
      </svg>
      <p className="text-xs text-muted-foreground">
        {done} of {total} item{total === 1 ? "" : "s"} delivered
      </p>
    </div>
  );
}

/** The gauge's legend: one row per status category, dot + word + count. */
function DeliveryLegend({
  counts,
  total,
}: {
  counts: StatusCounts;
  total: number;
}) {
  return (
    <div className="mt-3 flex flex-col">
      <div
        aria-hidden
        className="mb-2 flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted"
      >
        {DISTRIBUTION_SEGMENTS.map((segment) =>
          counts[segment.key] > 0 ? (
            <span
              key={segment.key}
              className={cn("h-full", segment.bar)}
              style={{ width: `${(counts[segment.key] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      {DISTRIBUTION_SEGMENTS.map((segment) => (
        <div
          key={segment.key}
          className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
        >
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", segment.dot)}
          />
          <span className="flex-1 text-sm text-muted-foreground">
            {segment.label}
          </span>
          <span className="text-sm font-bold tabular-nums">
            {counts[segment.key]}
          </span>
        </div>
      ))}
    </div>
  );
}

/** An effort fact as a sidebar row: muted label left, bold value right. */
function AsideStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="text-sm font-bold tabular-nums">{value}</span>
        {sub ? (
          <span className="block text-[11px] text-muted-foreground">{sub}</span>
        ) : null}
      </span>
    </div>
  );
}

const VIEW_ICONS: Record<BacklogView, typeof IconList> = {
  backlog: IconList,
  board: IconLayoutKanban,
  table: IconTable,
  timeline: IconTimeline,
};

/**
 * The backlog screen: one dataset, four ways of looking at it.
 *
 * The view lives in the URL (`?view=board`) rather than in state, so a board a
 * teammate is looking at is a link they can send, and a refresh doesn't drop
 * you back into the list.
 *
 * Layout: the view switcher sits directly on the canvas under the header (an
 * underline nav, not another card), and the ranked backlog view splits into a
 * content column plus an insights rail — active-sprint delivery and effort
 * reporting — instead of the old full-width stat band. The visual views
 * (board, table, timeline) keep the whole canvas.
 */
export function BacklogPanel(props: React.ComponentProps<typeof BacklogBody>) {
  // Everything the panel and its child views remember — filters, grouping,
  // hierarchy, the gantt's zoom, the table's column widths — is an answer about
  // THIS project, so the scope is contributed once here rather than threaded
  // into each view as a prop.
  return (
    <PreferenceScopeProvider scope={`project:${props.project.id}`}>
      <BacklogBody {...props} />
    </PreferenceScopeProvider>
  );
}

function BacklogBody({
  project,
  basePath,
  view,
  data,
  abilities,
  page = "backlog",
}: {
  project: {
    id: string;
    key: string;
    name: string;
    capacityUnit: "hours" | "points";
  };
  /** /app/[orgSlug]/[projectKey] — item routes hang off it. */
  basePath: string;
  view: BacklogView;
  data: BacklogData;
  abilities: {
    create: boolean;
    update: boolean;
    delete: boolean;
    assign: boolean;
    prioritize: boolean;
  };
  /**
   * Which route is hosting the panel. The dedicated board page pins the board
   * view and drops the view-switcher tabs; the backlog page keeps all four
   * views behind `?view=`.
   */
  page?: "backlog" | "board";
}) {
  const boardPage = page === "board";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // This screen, as the origin every link that leaves it carries. `?view=` is
  // part of it: the four views share a route, so without the query a reader who
  // opened an item off the gantt would be handed back the ranked list.
  const returnTo = useReturnToHref();
  const [, startTransition] = useTransition();
  const live = useBacklogStream(project.id, () => router.refresh());

  // Optimistic copy: a drag has to land under the cursor before the server
  // answers. It resyncs whenever the server sends a new list (adjusting state
  // during render — an effect would paint the stale order for a frame first).
  const [items, setItems] = useState(data.items);
  const [renderedFrom, setRenderedFrom] = useState(data.items);
  if (renderedFrom !== data.items) {
    setRenderedFrom(data.items);
    setItems(data.items);
  }

  // Which items the right-click menu acts on, held ABOVE the four views: the
  // views disagree about how a row looks, not about which work you meant, so a
  // set ticked in the list is still the set on the board.
  const selection = useItemSelection();

  // Every filter takes a set, not a value: an empty array means "everything",
  // so a type or sprint added after the fact is visible by default.
  const [search, setSearch] = useState("");
  // The ranked list reads as a TREE by default: parent/child is how the work
  // was planned, so hiding it behind a toggle would make the hierarchy invisible
  // to anyone who never found the switch. Off falls back to the flat rank list.
  const [nestedList, setNestedList] = usePersistedFlag("backlog.nested", true);
  // One ranked list of everything by default: sprint membership is a chip on
  // the row, and narrowing to a sprint is what the sprint filter is for.
  // Grouping is the PLANNING posture — turn it on to drag work into a sprint.
  const [grouping, setGrouping] = usePersistedChoice<BacklogGrouping>(
    "backlog.grouping",
    "none",
    BACKLOG_GROUPINGS,
  );
  // The four filters persist; `search` deliberately does not. A narrowed list
  // is a working set you come back to, but a leftover search box would look
  // like an empty backlog to anyone who forgot they typed in it.
  // Status narrows every view, the board included: its columns stay put (they
  // are the drop targets that CHANGE a status), only the cards thin out.
  const [statusFilter, setStatusFilter] = usePersistedState<string[]>(
    "backlog.filter.status",
    EMPTY_FILTER,
    reviveStringArray,
  );
  const [typeFilter, setTypeFilter] = usePersistedState<string[]>(
    "backlog.filter.type",
    EMPTY_FILTER,
    reviveStringArray,
  );
  const [assigneeFilter, setAssigneeFilter] = usePersistedState<string[]>(
    "backlog.filter.assignee",
    EMPTY_FILTER,
    reviveStringArray,
  );
  const [sprintFilter, setSprintFilter] = usePersistedState<string[]>(
    "backlog.filter.sprint",
    EMPTY_FILTER,
    reviveStringArray,
  );

  function setView(next: BacklogView) {
    trackEvent("backlog.view_mode_change", {
      view: next,
      project: project.key,
    });
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  /**
   * A meaning-based search result: the ids the embeddings ranked, best first.
   * It replaces the literal substring match while it's on — asking for "users
   * can't log in" and then still filtering by those exact words would throw
   * away everything the search just found.
   */
  const [semantic, setSemantic] = useState<{
    query: string;
    ids: string[];
  } | null>(null);
  const [searching, startSearching] = useTransition();

  function runSemanticSearch() {
    const query = search.trim();
    if (query.length < 2) return;
    trackEvent("backlog.search", {
      type: "semantic",
      length: query.length,
      project: project.key,
    });
    startSearching(async () => {
      try {
        const result = await searchWorkItemsByMeaning({
          projectId: project.id,
          query,
        });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        setSemantic({ query, ids: result.items.map((row) => row.id) });
        if (result.items.length === 0) toast.info("No related items found.");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "That search failed.",
        );
      }
    });
  }

  function clearFilters() {
    trackEvent("backlog.filter", { action: "clear", project: project.key });
    setSearch("");
    setSemantic(null);
    setStatusFilter([]);
    setTypeFilter([]);
    setAssigneeFilter([]);
    setSprintFilter([]);
  }

  const needle = semantic ? "" : search.trim().toLowerCase();
  const semanticRank = semantic
    ? new Map(semantic.ids.map((id, index) => [id, index]))
    : null;
  // Within one filter the chosen values are an OR; across filters they are an
  // AND — "bugs or tasks, assigned to me or nobody". `none` is the sentinel for
  // the empty slot (unassigned / not in a sprint), which has no id of its own.
  const statuses = new Set(statusFilter);
  const types = new Set(typeFilter);
  const assignees = new Set(assigneeFilter);
  const sprints = new Set(sprintFilter);
  /**
   * Whether a row survives the current search and filters. Named rather than
   * inlined because the inline composer asks the same question about the item it
   * has just created: an item the active filters hide would otherwise be
   * created into an apparently unchanged list.
   */
  function matchesFilters(item: FilterableRow) {
    if (semanticRank && !semanticRank.has(item.id)) return false;
    if (statuses.size > 0 && !statuses.has(item.statusId)) return false;
    if (types.size > 0 && !types.has(item.typeId)) return false;
    if (assignees.size > 0) {
      const key = item.assigneeMemberId ?? "none";
      if (!assignees.has(key)) return false;
    }
    if (sprints.size > 0) {
      const key = item.sprintId ?? "none";
      if (!sprints.has(key)) return false;
    }
    if (!needle) return true;
    return (
      item.summary.toLowerCase().includes(needle) ||
      item.key.toLowerCase().includes(needle) ||
      item.labels.some((label) => label.toLowerCase().includes(needle))
    );
  }

  const filtered = items.filter(matchesFilters);
  const visibleItemIds = filtered.map((item) => item.id);
  const hasVisibleItems = visibleItemIds.length > 0;

  // Relevance order, but only while a meaning search is on: every other view
  // keeps the backlog's own rank, which is what the drag handles move.
  if (semanticRank) {
    filtered.sort(
      (left, right) =>
        (semanticRank.get(left.id) ?? 0) - (semanticRank.get(right.id) ?? 0),
    );
  }

  // Every item bucketed by its status's category. The delivery card below
  // deliberately scopes this to the current sprint rather than presenting a
  // project-wide aggregate beside sprint-specific effort figures.
  const categoryOf = new Map(
    data.statuses.map((status) => [status.id, status.category]),
  );
  const unitLabel = project.capacityUnit === "points" ? "pts" : "h";
  const activeSprint = data.sprints.find((sprint) => sprint.state === "active");
  const activeSprintItems = activeSprint
    ? items.filter((item) => item.sprintId === activeSprint.id)
    : [];
  const counts: StatusCounts = { todo: 0, in_progress: 0, done: 0 };
  for (const item of activeSprintItems) {
    counts[categoryOf.get(item.statusId) ?? "todo"] += 1;
  }
  // Estimates use their existing hierarchy-aware roll-up. Actual effort is
  // intentionally not rolled up: it is time recorded directly on each row.
  const estimated = activeSprint ? sumEstimates(activeSprintItems, items) : 0;
  const actual = activeSprintItems.reduce(
    (total, item) => total + (item.actualEfforts ?? 0),
    0,
  );
  const unestimated = activeSprint
    ? countUnestimated(activeSprintItems, items)
    : 0;

  function handleMove(payload: MovePayload) {
    const item = items.find((row) => row.id === payload.workItemId);
    if (!item) return;
    const snapshot = items;

    // The same midpoint the server will compute, so the row lands in its final
    // position immediately instead of jumping when the refresh arrives.
    let rank = item.rank;
    if (payload.beforeId !== undefined || payload.afterId !== undefined) {
      const beforeRank =
        items.find((row) => row.id === payload.beforeId)?.rank ?? null;
      const afterRank =
        items.find((row) => row.id === payload.afterId)?.rank ?? null;
      try {
        rank = between(beforeRank, afterRank);
      } catch {
        // Out-of-order neighbours mean this list is stale; let the server
        // decide and re-read rather than guessing a position.
        rank = item.rank;
      }
    }

    // `parentId` rides along in the SAME call: `moveWorkItem` checks
    // `item:update` for the re-parent before its single write, so a drop that
    // re-parents and re-ranks either lands whole or is refused whole. Splitting
    // it across two actions used to leave the parent change committed while the
    // rank was refused and the UI rolled back to the old snapshot.
    const { parentId } = payload;

    setItems((current) =>
      [...current]
        .map((row) =>
          row.id === item.id
            ? {
                ...row,
                statusId: payload.statusId ?? row.statusId,
                sprintId:
                  payload.sprintId === undefined
                    ? row.sprintId
                    : payload.sprintId,
                parentId: parentId === undefined ? row.parentId : parentId,
                rank,
              }
            : row,
        )
        .sort((left, right) => left.rank.localeCompare(right.rank)),
    );

    startTransition(async () => {
      try {
        // A refusal comes back as data, not as a throw: production strips the
        // message off anything thrown from a server action.
        const result = await moveWorkItem(payload);
        if (result?.error) {
          setItems(snapshot);
          toast.error(result.error);
          return;
        }
        router.refresh();
      } catch (error) {
        setItems(snapshot);
        toast.error(
          error instanceof Error ? error.message : "Couldn't move that item.",
        );
      }
    });
  }

  /**
   * A checked list selection is moved by one atomic server operation so a
   * large selection does not wait for a request per row.
   */
  function handleMoveMany(payload: MoveItemsPayload) {
    startTransition(async () => {
      try {
        const result = await moveWorkItems(payload);
        if (result?.error) {
          toast.error(result.error);
          router.refresh();
          return;
        }
        selection.clear();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't move the selected items.",
        );
        router.refresh();
      }
    });
  }

  /** The row's "detach from parent" button — the drag has no gesture for it. */
  function handleUnnest(item: WorkItemRow) {
    const snapshot = items;
    setItems((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, parentId: null } : row,
      ),
    );

    startTransition(async () => {
      try {
        await setWorkItemParent({ workItemId: item.id, parentId: null });
        router.refresh();
      } catch (error) {
        setItems(snapshot);
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't detach that item from its parent.",
        );
      }
    });
  }

  /**
   * The right-click menu's write: ONE attribute, over the row that was clicked
   * or the whole selection.
   *
   * Optimistic like the drag, and for the same reason — a menu that closes and
   * then leaves the row unchanged for a beat is indistinguishable from one that
   * missed the click. A refusal comes back as data (production strips the
   * message off anything a server action throws), so it rolls back and says why.
   */
  function handleAttributes(payload: AttributesPayload) {
    const ids = new Set(payload.workItemIds);
    if (!items.some((row) => ids.has(row.id))) return;
    const snapshot = items;

    // The assignee's name and avatar are rendered from the ROW, not fetched per
    // cell, so the optimistic copy has to carry them or the row would show an
    // empty slot until the refresh landed.
    const assignee = payload.assigneeMemberId
      ? (data.members.find(
          (row) => row.memberId === payload.assigneeMemberId,
        ) ?? null)
      : null;

    setItems((current) =>
      current.map((row) =>
        ids.has(row.id)
          ? {
              ...row,
              statusId: payload.statusId ?? row.statusId,
              sprintId:
                payload.sprintId === undefined
                  ? row.sprintId
                  : payload.sprintId,
              priority: payload.priority ?? row.priority,
              points:
                payload.points === undefined ? row.points : payload.points,
              ...(payload.assigneeMemberId === undefined
                ? {}
                : {
                    assigneeMemberId: payload.assigneeMemberId,
                    assigneeName: assignee?.name ?? null,
                    assigneeImage: assignee?.image ?? null,
                  }),
            }
          : row,
      ),
    );

    startTransition(async () => {
      try {
        const result = await setWorkItemAttributes(payload);
        if (result?.error) {
          setItems(snapshot);
          toast.error(result.error);
          return;
        }
        // One row speaks for itself — it changed under the cursor. A batch does
        // not: the rows it touched may be scattered down several sprint cards.
        if (payload.workItemIds.length > 1) {
          toast.success(`Updated ${result?.updated ?? 0} items.`);
        }
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't update those items.",
        );
        setItems(snapshot);
      }
    });
  }

  /**
   * The board's inline composer: a title and a type, in the column that was
   * clicked. It awaits the server rather than inserting optimistically —
   * the row needs a key, a number and a rank only the server can mint, and a
   * card that had to renumber itself a beat later would be worse than one that
   * arrives whole.
   */
  async function handleQuickCreate(input: {
    statusId: string;
    typeId: string;
    summary: string;
  }): Promise<boolean> {
    try {
      await createWorkItem({ projectId: project.id, ...input });
      router.refresh();
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create that item.",
      );
      return false;
    }
  }

  // An item is a page, not a dialog: it is linkable, refreshable and has room
  // for the prose blocks. Prefetched so opening one off the board is instant.
  function openItem(item: WorkItemRow) {
    trackEvent("work_item.view", { key: item.key, typeId: item.typeId });
    router.push(withReturnTo(`${basePath}/backlog/${item.key}`, returnTo));
  }

  /**
   * The full create form, from wherever this panel is mounted, with the way
   * back on it. The inline composer covers the common case; this is where the
   * fields it deliberately doesn't carry (dates, value, risk, parent, custom
   * fields) still live, and where a type with required custom fields lands.
   */
  const newItemHref = withReturnTo(`${basePath}/backlog/new`, returnTo);

  /**
   * Adding work is done ON this screen: the composer opens under the toolbar,
   * stays open across creates, and the list re-reads beneath it. Not persisted —
   * an open form is a thing you are doing, not a preference.
   *
   * The state IS the seed, so every "add here" gesture on the screen — the
   * header button, a sprint section's `+` — lands in the same one card with the
   * sprint or status that gesture named already picked.
   */
  const [composing, setComposing] = useState<ComposerSeed | null>(null);

  /**
   * What the FILTERS imply, for the gestures that name nothing themselves.
   * Exactly one sprint or status selected is an answer ("Sprint 14"); several is
   * not, and `none` names the empty slot, so both fall back to the default.
   */
  function filterSeed(): ComposerSeed {
    return {
      sprintId:
        sprintFilter.length === 1 && sprintFilter[0] !== "none"
          ? sprintFilter[0]
          : null,
      statusId: statusFilter.length === 1 ? statusFilter[0] : null,
    };
  }

  // The selection as rows, resolved once here rather than inside each of the
  // hundreds of menus a long list mounts.
  const selectedRows = items.filter((row) => selection.ids.has(row.id));

  /**
   * Everything the right-click menu needs, built once and handed to whichever
   * view is on screen. All four raise the SAME menu — an attribute is an
   * attribute whether you found the row in a list, a column, a table or a bar.
   */
  const menu: BacklogMenuContext = {
    members: data.members,
    sprints: data.sprints,
    statuses: data.statuses,
    capacityUnit: project.capacityUnit,
    canAssign: abilities.assign,
    canSchedule: abilities.prioritize,
    canUpdate: abilities.update,
    selection,
    // The whole selection when the row that was right-clicked is part of one,
    // and only that row otherwise — the rule every file manager follows, and
    // the only one under which the menu's "3 items" header is trustworthy.
    targetsFor: (item) =>
      selection.ids.has(item.id) && selectedRows.length > 0
        ? selectedRows
        : [item],
    onApply: handleAttributes,
    onOpen: openItem,
  };

  const empty = items.length === 0;

  /**
   * The inline creation form, rendered above whichever view is on screen so the
   * new row appears in the list the reader is already looking at.
   *
   * Keyed by the seed: pressing a DIFFERENT sprint section's `+` while the card
   * is open re-opens it for that sprint rather than leaving the picker pointing
   * at the section you pressed first.
   */
  const composer = composing ? (
    <InlineItemComposer
      key={`composer-${composing.sprintId ?? "backlog"}-${composing.statusId ?? "default"}`}
      ai={data.ai}
      basePath={basePath}
      capacityUnit={project.capacityUnit}
      fields={data.fields}
      fullFormHref={newItemHref}
      labelSuggestions={Array.from(
        new Set(items.flatMap((row) => row.labels)),
      ).sort((left, right) => left.localeCompare(right))}
      members={data.members}
      onClose={() => setComposing(null)}
      onCreated={(created) => {
        router.refresh();
        // Created into a narrowed list, the row can be real and invisible — a
        // type filter or a leftover search is enough. Said out loud, because
        // "nothing happened" is the other reading.
        if (!matchesFilters(created)) {
          toast.info(
            `${created.key} is in the backlog, but the current search and filters hide it.`,
          );
        }
      }}
      presets={composing}
      projectId={project.id}
      sprints={data.sprints}
      statuses={data.statuses}
      types={data.types}
    />
  ) : null;

  /**
   * The header's one primary action: the FULL create form, on its own page —
   * every field, attachments, custom fields, the AI draft card. The toolbar's
   * "Add inline" is the fast path beside it; they are deliberately two controls
   * because they answer two different questions ("file this properly" vs "get
   * this line into the backlog before I lose it").
   */
  const createButton = abilities.create ? (
    <Button nativeButton={false} render={<Link href={newItemHref} />}>
      <IconPlus className="size-4" />
      New item
    </Button>
  ) : null;

  /** The toolbar's opener for the inline composer. */
  const inlineButton = abilities.create ? (
    <Button
      aria-expanded={composing !== null}
      onClick={() => setComposing((current) => (current ? null : filterSeed()))}
      size="sm"
      title="Add items without leaving this screen"
      variant={composing ? "secondary" : "outline"}
    >
      <IconPlus className="size-4" />
      Add inline
    </Button>
  ) : null;

  // The view switcher lives on the canvas — an underline nav under the page
  // header, not another floating card in the stack of cards.
  const tabBar = (
    <div
      // overflow-y-hidden is load-bearing: `overflow-x-auto` alone makes the Y
      // axis compute to `auto` too, and the tabs' `-mb-px` leaves exactly 1px
      // of vertical overflow — enough for the browser to paint a full vertical
      // scrollbar next to the tabs.
      className="sticky top-0 z-30 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-canvas"
      role="tablist"
      aria-label="Backlog views"
    >
      {BACKLOG_VIEWS.map((candidate) => {
        const Icon = VIEW_ICONS[candidate];
        const active = candidate === view;
        return (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setView(candidate)}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {BACKLOG_VIEW_LABELS[candidate]}
          </button>
        );
      })}
      {/* Live answer to "what am I looking at" — sits with the view switcher
          because filters change it. aria-live keeps it out of the tab order
          but announced when a filter narrows the list. */}
      <span
        aria-live="polite"
        className="ml-auto hidden whitespace-nowrap pl-3 pr-1 text-xs tabular-nums text-muted-foreground sm:block"
      >
        {filtered.length === items.length
          ? `${items.length} item${items.length === 1 ? "" : "s"}`
          : `${filtered.length} of ${items.length} shown`}
      </span>
    </div>
  );

  // One slim toolbar card. Sticky: on the long list/table views the search and
  // filters stay reachable however far down the backlog goes. (Left bare on
  // the canvas, transparent-filled controls read as disabled — hence a card.)
  const toolbar = (
    <div className="sticky top-10 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-card">
      {/* Leads the toolbar: adding work is what the row is FOR on a grooming
          pass, and the composer opens directly beneath this card. */}
      {inlineButton}
      <Button
        disabled={!hasVisibleItems}
        onClick={() => selection.selectAll(visibleItemIds)}
        size="sm"
        title="Select every item currently shown"
        variant="outline"
      >
        Select all
      </Button>
      <Button
        disabled={selection.ids.size === 0}
        onClick={selection.clear}
        size="sm"
        title="Clear every selected item"
        variant="outline"
      >
        Unselect all
      </Button>
      <Input
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          // Editing the box means the AI result no longer answers what is
          // written in it — drop back to the literal match.
          setSemantic(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") runSemanticSearch();
        }}
        placeholder="Search summary, key or label"
        aria-label="Search work items"
        className="w-full min-w-40 sm:w-auto sm:max-w-xs sm:flex-1"
      />
      {/* Only where the org actually has an embedding model: without one this
          button can only ever answer "semantic search needs an embedding
          model", which is not a thing to put in a toolbar. */}
      {data.ai.embedding ? (
        <Button
          disabled={searching || search.trim().length < 2}
          onClick={runSemanticSearch}
          size="sm"
          title="Find items that mean the same thing, not just ones with these words"
          variant="outline"
        >
          {searching ? (
            <Spinner className="size-4" />
          ) : (
            <IconSparkles className="size-4" />
          )}
          Search by meaning
        </Button>
      ) : null}
      {/* Every list-shaped view nests off this one switch. The board is the
          exception: its cards are already grouped by status, and a column of
          indented cards would read as a second, competing hierarchy. */}
      {!boardPage && view !== "board" ? (
        <Button
          aria-pressed={nestedList}
          onClick={() => setNestedList((current) => !current)}
          size="sm"
          title="Nest child items under their parent"
          variant={nestedList ? "secondary" : "outline"}
        >
          <IconSitemap className="size-4" />
          Hierarchy
        </Button>
      ) : null}
      {/* Every view that reads as a list groups the same way, off the same
          control. The board is the exception — its columns already ARE a
          grouping, by status, and it has no second axis to spend. */}
      {!boardPage && view !== "board" ? (
        <Button
          aria-pressed={grouping === "sprint"}
          onClick={() =>
            setGrouping((current) => (current === "sprint" ? "none" : "sprint"))
          }
          size="sm"
          title="Split the list into one card per sprint — drag items between them to plan"
          variant={grouping === "sprint" ? "secondary" : "outline"}
        >
          <IconRocket className="size-4" />
          Group by sprint
        </Button>
      ) : null}
      {/* Status leads the filter row: it is the axis people work by. On the
          board it narrows the CARDS and leaves the columns standing, so a card
          can still be dragged out of the status you filtered to. */}
      <MultiSelectFilter
        ariaLabel="Filter by status"
        emptyLabel="Any status"
        values={statusFilter}
        onValueChange={setStatusFilter}
        options={data.statuses.map((status) => ({
          value: status.id,
          label: status.name,
        }))}
      />
      <MultiSelectFilter
        ariaLabel="Filter by type"
        emptyLabel="All types"
        values={typeFilter}
        onValueChange={setTypeFilter}
        options={data.types.map((type) => ({
          value: type.id,
          label: type.name,
        }))}
      />
      <MultiSelectFilter
        ariaLabel="Filter by assignee"
        emptyLabel="Anyone"
        values={assigneeFilter}
        onValueChange={setAssigneeFilter}
        options={[
          { value: "none", label: "Unassigned" },
          ...data.members.map((row) => ({
            value: row.memberId,
            label: row.name,
          })),
        ]}
      />
      <MultiSelectFilter
        ariaLabel="Filter by sprint"
        emptyLabel="Any sprint"
        values={sprintFilter}
        onValueChange={setSprintFilter}
        options={[
          { value: "none", label: "Backlog only" },
          ...data.sprints.map((sprint) => ({
            value: sprint.id,
            label: sprint.name,
          })),
        ]}
      />
      {semantic ? (
        <span className="flex min-w-0 items-center gap-1.5 rounded-[8px] bg-secondary px-2 py-1 text-secondary-foreground text-xs">
          <IconSparkles className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            {semantic.ids.length} related to “{semantic.query}”
          </span>
        </span>
      ) : null}
      {search ||
      statuses.size > 0 ||
      types.size > 0 ||
      assignees.size > 0 ||
      sprints.size > 0 ? (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      ) : null}
      {/* On the board page there is no tab bar to carry the count, so the
          toolbar announces it instead. */}
      {boardPage ? (
        <span
          aria-live="polite"
          className="ml-auto hidden whitespace-nowrap pl-3 pr-1 text-xs tabular-nums text-muted-foreground sm:block"
        >
          {filtered.length === items.length
            ? `${items.length} item${items.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${items.length} shown`}
        </span>
      ) : null}
    </div>
  );

  /**
   * What the next right-click will act on, said outright — the ticked rows are
   * spread down several cards (or, on the board, several columns) and counting
   * them is not the reader's job.
   *
   * It sits above the view rather than inside one because the selection does
   * too: switch from the list to the board and the same six items are still
   * picked. The hint changes with the view, since the gesture does — a card and
   * a Gantt row have nowhere to hang a tick box.
   */
  const selectionBar =
    selection.ids.size > 0 ? (
      <div
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-secondary px-3 py-2 text-secondary-foreground shadow-card"
      >
        <span className="text-xs font-semibold tabular-nums">
          {selection.ids.size} selected
        </span>
        <span className="hidden text-xs sm:inline">
          {view === "board" || view === "timeline"
            ? "Ctrl-click to add, shift-click for a range, right-click to edit them together."
            : "Right-click any selected row to assign, schedule or edit them together."}
        </span>
        <button
          type="button"
          onClick={selection.clear}
          className="ml-auto rounded-md px-2 py-1 text-xs font-semibold transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Clear
        </button>
      </div>
    ) : null;

  // Every view would render blank against these filters — one shared state
  // names the cause and offers the way out.
  const noMatches = (
    <div className="rounded-lg border border-border bg-card p-10 text-center shadow-card">
      <p className="font-semibold text-sm">No matches</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Nothing matches the current search and filters — adjust or clear them.
      </p>
      <Button
        className="mt-4"
        size="sm"
        variant="outline"
        onClick={clearFilters}
      >
        Clear filters
      </Button>
    </div>
  );

  return (
    // Every view below reads a parent's estimate from its children, so the
    // roll-up is computed once here over the WHOLE project — a filtered list
    // must not change what an epic is carrying.
    <EstimateProvider items={items}>
      <PageContainer width="full" fill className="gap-4">
        {/* Compact header: identity + the one primary action. The tabs beneath
          already name the four ways of looking. */}
        <PageHeader
          eyebrow={project.key}
          title={boardPage ? "Board" : "Backlog"}
        >
          <span
            aria-live="polite"
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-chip px-2 py-1 text-xs font-semibold text-foreground"
            role="status"
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                live ? "bg-success" : "bg-warning",
              )}
            />
            {live ? "Live" : "Reconnecting"}
          </span>
          {createButton}
        </PageHeader>

        {empty && composing ? (
          // The first item is created in the same card as every later one — an
          // empty state that handed you off to another route would make the
          // very first create the one that behaves differently.
          <div className="mx-auto w-full max-w-3xl">{composer}</div>
        ) : empty ? (
          // Full-height centring: the empty state owns the viewport instead of
          // hanging off the top of an otherwise blank canvas.
          <div className="grid min-h-0 flex-1 place-items-center">
            <div className="w-full max-w-lg rounded-lg border border-border bg-card p-10 text-center shadow-card">
              <div className="mx-auto grid size-11 place-items-center rounded-md bg-chip text-brand">
                <IconList className="size-5" />
              </div>
              <p className="mt-3 font-semibold text-sm">No work items yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Work items are the stories, tasks and bugs the team delivers —
                create one and it lands in the backlog, ready to be planned into
                a sprint.
              </p>
              {/* Both paths, because the toolbar that normally carries the
                  inline one only exists once there is a list to filter. */}
              {abilities.create ? (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    nativeButton={false}
                    render={<Link href={newItemHref} />}
                  >
                    <IconPlus className="size-4" />
                    Create the first item
                  </Button>
                  <Button
                    onClick={() => setComposing(filterSeed())}
                    variant="outline"
                  >
                    Add inline
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {boardPage ? null : tabBar}

            {view === "backlog" ? (
              // The ranked list reads best at prose width, which leaves room for
              // an insights rail: the delivery gauge and planning numbers that
              // used to be a full-width band across the top. On smaller screens
              // the rail stacks below the list — content first.
              <div className="grid min-h-0 flex-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex min-w-0 flex-col gap-4">
                  {toolbar}
                  {composer}
                  {selectionBar}
                  {filtered.length === 0 ? (
                    noMatches
                  ) : (
                    <BacklogListView
                      items={filtered}
                      allItems={items}
                      sprints={data.sprints}
                      statuses={data.statuses}
                      types={data.types}
                      menu={menu}
                      canMove={abilities.prioritize}
                      canNest={abilities.update}
                      canCreate={abilities.create}
                      nested={nestedList}
                      grouping={grouping}
                      capacityUnit={project.capacityUnit}
                      onOpen={openItem}
                      onMove={handleMove}
                      onMoveMany={handleMoveMany}
                      onUnnest={handleUnnest}
                      onCompose={setComposing}
                    />
                  )}
                </div>

                <aside
                  className="flex flex-col gap-4 xl:sticky xl:top-0"
                  aria-label="Backlog insights"
                >
                  <SectionCard
                    title="Delivery"
                    description={
                      activeSprint
                        ? `${activeSprint.name} · current sprint`
                        : "No active sprint"
                    }
                    className="p-4"
                  >
                    {activeSprint ? (
                      <>
                        <DeliveryGauge
                          done={counts.done}
                          total={activeSprintItems.length}
                        />
                        <DeliveryLegend
                          counts={counts}
                          total={activeSprintItems.length}
                        />
                      </>
                    ) : (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Start a sprint to see its delivery progress.
                      </p>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="Effort"
                    description={
                      activeSprint
                        ? "Estimated compared with time recorded"
                        : "Start a sprint to track effort"
                    }
                    className="p-4"
                  >
                    <AsideStat
                      label="Estimated effort"
                      value={`${estimated}${unitLabel}`}
                      sub={
                        activeSprint && unestimated > 0
                          ? `${unestimated} item${unestimated === 1 ? "" : "s"} without estimate`
                          : activeSprint
                            ? "every item estimated"
                            : "no active sprint"
                      }
                    />
                    <AsideStat
                      label="Actual effort"
                      value={`${actual}h`}
                      sub={
                        activeSprint
                          ? "time recorded in this sprint"
                          : "no time recorded"
                      }
                    />
                  </SectionCard>
                </aside>
              </div>
            ) : (
              <>
                {toolbar}
                {composer}
                {selectionBar}
                {filtered.length === 0 ? (
                  <div className="grid min-h-0 flex-1 place-items-center">
                    <div className="w-full max-w-lg">{noMatches}</div>
                  </div>
                ) : null}
                {filtered.length > 0 && view === "board" ? (
                  // The board owns the rest of the viewport: columns run full
                  // height and scroll their own cards, like a board should.
                  <div className="min-h-0 flex-1">
                    <BoardView
                      items={filtered}
                      statuses={data.statuses}
                      types={data.types}
                      fields={data.fields}
                      menu={menu}
                      canMove={abilities.update}
                      canReorder={abilities.prioritize}
                      canCreate={abilities.create}
                      basePath={basePath}
                      onOpen={openItem}
                      onMove={handleMove}
                      onQuickCreate={handleQuickCreate}
                    />
                  </div>
                ) : null}
                {filtered.length > 0 && view === "table" ? (
                  <TableView
                    items={filtered}
                    statuses={data.statuses}
                    sprints={data.sprints}
                    types={data.types}
                    menu={menu}
                    grouping={grouping}
                    nested={nestedList}
                    onOpen={openItem}
                  />
                ) : null}
                {filtered.length > 0 && view === "timeline" ? (
                  // Same deal as the board: the gantt runs to the bottom of the
                  // viewport and scrolls its own rows.
                  <div className="min-h-0 flex-1">
                    <TimelineView
                      items={filtered}
                      sprints={data.sprints}
                      statuses={data.statuses}
                      menu={menu}
                      grouping={grouping}
                      nested={nestedList}
                      canEdit={abilities.update}
                      canReorder={abilities.prioritize}
                      onOpen={openItem}
                      onMoved={() => router.refresh()}
                      onReordered={handleMove}
                    />
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </PageContainer>
    </EstimateProvider>
  );
}

/**
 * The stream carries only a project-change signal. A router refresh preserves
 * the existing server data boundary and re-checks the reader's permissions.
 */
function useBacklogStream(projectId: string, onChange: () => void): boolean {
  const handler = useRef(onChange);
  handler.current = onChange;
  const [live, setLive] = useState(true);

  useEffect(() => {
    const source = new EventSource(
      `/api/projects/${encodeURIComponent(projectId)}/backlog/stream`,
    );
    let opened = false;

    source.onopen = () => {
      if (opened) handler.current();
      opened = true;
      setLive(true);
    };
    source.onerror = () => setLive(false);
    source.addEventListener("backlog", () => handler.current());

    const onVisible = () => {
      if (document.visibilityState === "visible") handler.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      source.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [projectId]);

  return live;
}
