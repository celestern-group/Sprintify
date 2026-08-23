"use client";

import {
  DndContext,
  type DragMoveEvent,
  MouseSensor,
  useDraggable,
  useSensor,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { useMouse, useThrottle, useWindowScroll } from "@uidotdev/usehooks";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInDays,
  differenceInHours,
  differenceInMonths,
  differenceInWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  formatDate,
  formatDistance,
  getDaysInMonth,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { atom, useAtom } from "jotai";
import throttle from "lodash.throttle";
import { ChevronDownIcon, PlusIcon, TrashIcon } from "lucide-react";
import type {
  CSSProperties,
  FC,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
  RefObject,
} from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

const draggingAtom = atom(false);
const scrollXAtom = atom(0);

export const useGanttDragging = () => useAtom(draggingAtom);
export const useGanttScrollX = () => useAtom(scrollXAtom);

export type GanttStatus = {
  id: string;
  name: string;
  color: string;
};

export type GanttFeature = {
  id: string;
  name: string;
  startAt: Date;
  endAt: Date;
  status: GanttStatus;
  lane?: string; // Optional: features with the same lane will share a row
};

export type GanttMarkerProps = {
  id: string;
  date: Date;
  label: string;
};

export type Range = "daily" | "weekly" | "monthly" | "quarterly";

/**
 * LOCAL ADDITION — the weekly range.
 *
 * Upstream ships daily / monthly / quarterly. Weekly is the useful zoom for a
 * two-week sprint: months squash it to a stub, days push the neighbouring
 * sprint off-screen.
 *
 * The grid is deliberately NOT calendar weeks. A column is a 7-day block
 * counted from 1 January of the timeline's first year, so a column boundary
 * never has to fall on a year boundary — which is what keeps the per-year
 * header blocks and the pixel offsets on the same grid (365 isn't a multiple
 * of 7, so a per-year "52 or 53 calendar weeks" split would drift a few days
 * further out of step with every year added). Year headers simply break at the
 * nearest block boundary, at most three days from 1 January.
 */
const WEEK_DAYS = 7;

/** Column index, from the start of the timeline, of `date`. Fractional — the
 * fraction is the position inside the week. */
const weekColumnFor = (date: Date, timelineStartDate: Date) =>
  differenceInDays(date, timelineStartDate) / WEEK_DAYS;

/** First column index and column count of `yearIndex`, rounded to the shared
 * 7-day grid so the year blocks tile it exactly. */
const weekColumnsForYear = (data: TimelineData, yearIndex: number) => {
  const timelineStartDate = new Date(data[0].year, 0, 1);
  const start = Math.round(
    weekColumnFor(new Date(data[yearIndex].year, 0, 1), timelineStartDate),
  );
  const end = Math.round(
    weekColumnFor(new Date(data[yearIndex].year + 1, 0, 1), timelineStartDate),
  );

  return { start, columns: end - start };
};

export type TimelineData = {
  year: number;
  quarters: {
    months: {
      days: number;
    }[];
  }[];
}[];

export type GanttContextProps = {
  zoom: number;
  range: Range;
  columnWidth: number;
  sidebarWidth: number;
  headerHeight: number;
  rowHeight: number;
  onAddItem: ((date: Date) => void) | undefined;
  placeholderLength: number;
  timelineData: TimelineData;
  ref: RefObject<HTMLDivElement | null> | null;
  scrollToFeature?: (feature: GanttFeature) => void;
  scrollToDate?: (date: Date, behavior?: ScrollBehavior) => void;
  /**
   * LOCAL MODIFICATION: set the item column's width, clamped to
   * {@link SIDEBAR_MIN_WIDTH}..{@link SIDEBAR_MAX_WIDTH}. Calling it also opts
   * this chart out of the responsive default — once a person has sized the
   * column, a window resize must not undo it.
   */
  resizeSidebar?: (width: number) => void;
};

/** Narrow enough to still show a key, wide enough not to swallow the axis. */
export const SIDEBAR_MIN_WIDTH = 140;
export const SIDEBAR_MAX_WIDTH = 560;

/**
 * The imperative surface of a Gantt, for controls that live OUTSIDE the
 * provider (a toolbar above the chart, say) and so can't read the context.
 * Pass a ref to `GanttProvider`'s `apiRef` to get one.
 */
export type GanttApi = {
  /** Centre the viewport on `date`. Honours `prefers-reduced-motion`. */
  scrollToDate: (date: Date, behavior?: ScrollBehavior) => void;
};

const getsDaysIn = (range: Range) => {
  // For when range is daily
  let fn = (_date: Date) => 1;

  if (range === "weekly") {
    fn = () => WEEK_DAYS;
  }

  if (range === "monthly" || range === "quarterly") {
    fn = getDaysInMonth;
  }

  return fn;
};

const getDifferenceIn = (range: Range) => {
  let fn = differenceInDays;

  if (range === "weekly") {
    fn = differenceInWeeks;
  }

  if (range === "monthly" || range === "quarterly") {
    fn = differenceInMonths;
  }

  return fn;
};

const getInnerDifferenceIn = (range: Range) => {
  let fn = differenceInHours;

  if (range === "weekly" || range === "monthly" || range === "quarterly") {
    fn = differenceInDays;
  }

  return fn;
};

const getStartOf = (range: Range) => {
  let fn = startOfDay;

  if (range === "weekly") {
    fn = startOfWeek;
  }

  if (range === "monthly" || range === "quarterly") {
    fn = startOfMonth;
  }

  return fn;
};

const getEndOf = (range: Range) => {
  let fn = endOfDay;

  if (range === "weekly") {
    fn = endOfWeek;
  }

  if (range === "monthly" || range === "quarterly") {
    fn = endOfMonth;
  }

  return fn;
};

const getAddRange = (range: Range) => {
  let fn = addDays;

  if (range === "weekly") {
    fn = addWeeks;
  }

  if (range === "monthly" || range === "quarterly") {
    fn = addMonths;
  }

  return fn;
};

const getDateByMousePosition = (context: GanttContextProps, mouseX: number) => {
  const timelineStartDate = new Date(context.timelineData[0].year, 0, 1);
  const columnWidth = (context.columnWidth * context.zoom) / 100;

  if (context.range === "weekly") {
    // Whole days off the shared 7-day grid — a drag should land on a date, not
    // snap to the start of the week it was dropped in.
    return addDays(
      timelineStartDate,
      Math.floor((mouseX / columnWidth) * WEEK_DAYS),
    );
  }

  const offset = Math.floor(mouseX / columnWidth);
  const daysIn = getsDaysIn(context.range);
  const addRange = getAddRange(context.range);
  const month = addRange(timelineStartDate, offset);
  const daysInMonth = daysIn(month);
  const pixelsPerDay = Math.round(columnWidth / daysInMonth);
  const dayOffset = Math.floor((mouseX % columnWidth) / pixelsPerDay);
  const actualDate = addDays(month, dayOffset);

  return actualDate;
};

const createInitialTimelineData = (today: Date) => {
  const data: TimelineData = [];

  data.push(
    { year: today.getFullYear() - 1, quarters: new Array(4).fill(null) },
    { year: today.getFullYear(), quarters: new Array(4).fill(null) },
    { year: today.getFullYear() + 1, quarters: new Array(4).fill(null) },
  );

  for (const yearObj of data) {
    yearObj.quarters = new Array(4).fill(null).map((_, quarterIndex) => ({
      months: new Array(3).fill(null).map((_, monthIndex) => {
        const month = quarterIndex * 3 + monthIndex;
        return {
          days: getDaysInMonth(new Date(yearObj.year, month, 1)),
        };
      }),
    }));
  }

  return data;
};

const getOffset = (
  date: Date,
  timelineStartDate: Date,
  context: GanttContextProps,
) => {
  const parsedColumnWidth = (context.columnWidth * context.zoom) / 100;

  if (context.range === "weekly") {
    return weekColumnFor(date, timelineStartDate) * parsedColumnWidth;
  }

  const differenceIn = getDifferenceIn(context.range);
  const startOf = getStartOf(context.range);
  const fullColumns = differenceIn(startOf(date), timelineStartDate);

  if (context.range === "daily") {
    return parsedColumnWidth * fullColumns;
  }

  const partialColumns = date.getDate();
  const daysInMonth = getDaysInMonth(date);
  const pixelsPerDay = parsedColumnWidth / daysInMonth;

  return fullColumns * parsedColumnWidth + partialColumns * pixelsPerDay;
};

/**
 * The bar's width in pixels.
 *
 * LOCAL MODIFICATION — `endAt` is the LAST DAY of the bar, matching our
 * inclusive stored end dates, so the width runs to the start of the day AFTER
 * it. Upstream measured to `endAt` itself, which drew every bar exactly one day
 * short: a Mon–Fri item stopped at Friday's left edge. That is what made a
 * right-edge resize look like it had landed a column left of where the handle
 * was dropped — the date was stored correctly and then drawn wrong.
 *
 * It is also the same subtraction as two offsets, for every range, which is
 * what keeps a bar's right edge on the pixel the axis puts that date on. The
 * hand-rolled per-range arithmetic it replaces disagreed with `getOffset`
 * across a month boundary.
 */
const getWidth = (
  startAt: Date,
  endAt: Date | null,
  timelineStartDate: Date,
  context: GanttContextProps,
) => {
  const parsedColumnWidth = (context.columnWidth * context.zoom) / 100;

  if (!endAt) {
    return parsedColumnWidth * 2;
  }

  const width =
    getOffset(addDays(endAt, 1), timelineStartDate, context) -
    getOffset(startAt, timelineStartDate, context);

  // Never thinner than the single day it occupies: an inverted range is a
  // mis-drop, and a negative width is silently dropped by CSS — leaving the bar
  // at its intrinsic size, which is the one width that means nothing at all.
  const oneDay = parsedColumnWidth / getsDaysIn(context.range)(startAt);

  return Math.max(width, oneDay);
};

const calculateInnerOffset = (
  date: Date,
  range: Range,
  columnWidth: number,
) => {
  const startOf = getStartOf(range);
  const endOf = getEndOf(range);
  const differenceIn = getInnerDifferenceIn(range);
  const startOfRange = startOf(date);
  const endOfRange = endOf(date);
  const totalRangeDays = differenceIn(endOfRange, startOfRange);
  const dayOfMonth = date.getDate();

  return (dayOfMonth / totalRangeDays) * columnWidth;
};

const GanttContext = createContext<GanttContextProps>({
  zoom: 100,
  range: "monthly",
  columnWidth: 50,
  headerHeight: 60,
  sidebarWidth: 300,
  rowHeight: 36,
  onAddItem: undefined,
  placeholderLength: 2,
  timelineData: [],
  ref: null,
  scrollToFeature: undefined,
  scrollToDate: undefined,
});

export type GanttContentHeaderProps = {
  renderHeaderItem: (index: number) => ReactNode;
  title: string;
  columns: number;
};

export const GanttContentHeader: FC<GanttContentHeaderProps> = ({
  title,
  columns,
  renderHeaderItem,
}) => {
  const id = useId();

  return (
    <div
      className="sticky top-0 z-20 grid w-full shrink-0 border-border border-b bg-card"
      style={{ height: "var(--gantt-header-height)" }}
    >
      <div>
        <div
          className="sticky inline-flex whitespace-nowrap px-3 py-2 font-bold text-[11px] text-muted-foreground uppercase tracking-[0.09em]"
          style={{
            left: "var(--gantt-sidebar-width)",
          }}
        >
          <p>{title}</p>
        </div>
      </div>
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(${columns}, var(--gantt-column-width))`,
        }}
      >
        {Array.from({ length: columns }).map((_, index) => (
          <div
            className="shrink-0 py-1.5 text-center font-semibold text-[11px] text-muted-foreground uppercase tabular-nums tracking-wide"
            key={`${id}-${index}`}
          >
            {renderHeaderItem(index)}
          </div>
        ))}
      </div>
    </div>
  );
};

const DailyHeader: FC = () => {
  const gantt = useContext(GanttContext);

  return gantt.timelineData.map((year) =>
    year.quarters
      .flatMap((quarter) => quarter.months)
      .map((month, index) => (
        <div className="relative flex flex-col" key={`${year.year}-${index}`}>
          <GanttContentHeader
            columns={month.days}
            renderHeaderItem={(item: number) => (
              <div className="flex items-center justify-center gap-1">
                <p>
                  {format(addDays(new Date(year.year, index, 1), item), "d")}
                </p>
                <p className="text-muted-foreground">
                  {format(
                    addDays(new Date(year.year, index, 1), item),
                    "EEEEE",
                  )}
                </p>
              </div>
            )}
            title={format(new Date(year.year, index, 1), "MMMM yyyy")}
          />
          <GanttColumns
            columns={month.days}
            isColumnSecondary={(item: number) =>
              [0, 6].includes(
                addDays(new Date(year.year, index, 1), item).getDay(),
              )
            }
          />
        </div>
      )),
  );
};

const WeeklyHeader: FC = () => {
  const gantt = useContext(GanttContext);
  const timelineStartDate = new Date(gantt.timelineData[0].year, 0, 1);

  return gantt.timelineData.map((year, yearIndex) => {
    const { start, columns } = weekColumnsForYear(
      gantt.timelineData,
      yearIndex,
    );
    const columnStart = (item: number) =>
      addDays(timelineStartDate, (start + item) * WEEK_DAYS);

    return (
      <div className="relative flex flex-col" key={year.year}>
        <GanttContentHeader
          columns={columns}
          renderHeaderItem={(item: number) => (
            <p>{format(columnStart(item), "d MMM")}</p>
          )}
          title={`${year.year}`}
        />
        {/* Alternating months give the week columns something to be read
            against — without it a year of identical columns has no landmarks. */}
        <GanttColumns
          columns={columns}
          isColumnSecondary={(item: number) =>
            columnStart(item).getMonth() % 2 === 1
          }
        />
      </div>
    );
  });
};

const MonthlyHeader: FC = () => {
  const gantt = useContext(GanttContext);

  return gantt.timelineData.map((year) => (
    <div className="relative flex flex-col" key={year.year}>
      <GanttContentHeader
        columns={year.quarters.flatMap((quarter) => quarter.months).length}
        renderHeaderItem={(item: number) => (
          <p>{format(new Date(year.year, item, 1), "MMM")}</p>
        )}
        title={`${year.year}`}
      />
      <GanttColumns
        columns={year.quarters.flatMap((quarter) => quarter.months).length}
      />
    </div>
  ));
};

const QuarterlyHeader: FC = () => {
  const gantt = useContext(GanttContext);

  return gantt.timelineData.map((year) =>
    year.quarters.map((quarter, quarterIndex) => (
      <div
        className="relative flex flex-col"
        key={`${year.year}-${quarterIndex}`}
      >
        <GanttContentHeader
          columns={quarter.months.length}
          renderHeaderItem={(item: number) => (
            <p>
              {format(new Date(year.year, quarterIndex * 3 + item, 1), "MMM")}
            </p>
          )}
          title={`Q${quarterIndex + 1} ${year.year}`}
        />
        <GanttColumns columns={quarter.months.length} />
      </div>
    )),
  );
};

const headers: Record<Range, FC> = {
  daily: DailyHeader,
  weekly: WeeklyHeader,
  monthly: MonthlyHeader,
  quarterly: QuarterlyHeader,
};

export type GanttHeaderProps = {
  className?: string;
};

export const GanttHeader: FC<GanttHeaderProps> = ({ className }) => {
  const gantt = useContext(GanttContext);
  const Header = headers[gantt.range];

  return (
    <div
      className={cn(
        "-space-x-px flex h-full w-max divide-x divide-border",
        className,
      )}
    >
      <Header />
    </div>
  );
};

export type GanttSidebarItemProps = {
  feature: GanttFeature;
  onSelectItem?: (id: string) => void;
  className?: string;
  /**
   * LOCAL MODIFICATION: hierarchy disclosure. Passing `onToggle` opts the row
   * into a leading chevron column — reserved as blank space on childless rows
   * so names stay on one left edge whatever the row is.
   */
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
};

export const GanttSidebarItem: FC<GanttSidebarItemProps> = ({
  feature,
  onSelectItem,
  className,
  hasChildren,
  collapsed,
  onToggle,
}) => {
  const gantt = useContext(GanttContext);
  const tempEndAt =
    feature.endAt && isSameDay(feature.startAt, feature.endAt)
      ? addDays(feature.endAt, 1)
      : feature.endAt;
  const duration = tempEndAt
    ? formatDistance(feature.startAt, tempEndAt)
    : `${formatDistance(feature.startAt, new Date())} so far`;

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (event.target === event.currentTarget) {
      // Scroll to the feature in the timeline
      gantt.scrollToFeature?.(feature);
      // Call the original onSelectItem callback
      onSelectItem?.(feature.id);
    }
  };

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    // Same target guard as the click path: Enter on the disclosure chevron
    // bubbles here, and folding a row must not also open it.
    if (event.key === "Enter" && event.target === event.currentTarget) {
      // Scroll to the feature in the timeline
      gantt.scrollToFeature?.(feature);
      // Call the original onSelectItem callback
      onSelectItem?.(feature.id);
    }
  };

  // LOCAL MODIFICATION: upstream makes every row a button whether or not it
  // does anything. Without `onSelectItem` the row is a LABEL — inert, no hover
  // affordance, no tab stop, and no jump to the bar. A caller that wants the
  // row to act passes the callback; the chevron and the bar stay interactive
  // either way.
  const interactive = Boolean(onSelectItem);

  return (
    <div
      className={cn(
        "relative flex items-center gap-2.5 px-3 text-xs outline-none transition-colors",
        interactive &&
          "cursor-pointer hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className,
      )}
      key={feature.id}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      role={interactive ? "button" : undefined}
      style={{
        height: "var(--gantt-row-height)",
      }}
      tabIndex={interactive ? 0 : undefined}
    >
      {/* <Checkbox onCheckedChange={handleCheck} className="shrink-0" /> */}
      {onToggle ? (
        hasChildren ? (
          <button
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Show" : "Hide"} children of ${feature.name}`}
            className="-m-1 shrink-0 rounded-sm p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              // The row itself is a button; without this the chevron would open
              // the item as well as fold it.
              event.stopPropagation();
              onToggle();
            }}
            type="button"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform",
                collapsed && "-rotate-90",
              )}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        )
      ) : null}
      <div
        className="pointer-events-none h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: feature.status.color,
        }}
      />
      <p className="pointer-events-none flex-1 truncate text-left font-semibold">
        {feature.name}
      </p>
      <p className="pointer-events-none shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {duration}
      </p>
    </div>
  );
};

export const GanttSidebarHeader: FC<{ label?: string }> = ({
  // LOCAL MODIFICATION: upstream hard-codes "Issues"; the same Gantt renders
  // sprints here, so the column name is a prop.
  label = "Issues",
}) => (
  <div
    className="sticky top-0 z-10 flex shrink-0 items-end justify-between gap-2.5 border-border border-b bg-card px-3 py-2 font-bold text-[11px] text-muted-foreground uppercase tracking-[0.09em]"
    style={{ height: "var(--gantt-header-height)" }}
  >
    {/* <Checkbox className="shrink-0" /> */}
    <p className="flex-1 truncate text-left">{label}</p>
    <p className="shrink-0">Duration</p>
  </div>
);

export type GanttSidebarGroupProps = {
  children: ReactNode;
  name: string;
  className?: string;
};

export const GanttSidebarGroup: FC<GanttSidebarGroupProps> = ({
  children,
  name,
  className,
}) => (
  <div className={className}>
    <p
      className="flex w-full items-center truncate px-3 text-left font-bold text-[11px] text-muted-foreground uppercase tracking-[0.09em]"
      style={{ height: "var(--gantt-row-height)" }}
    >
      {name}
    </p>
    <div className="divide-y divide-border">{children}</div>
  </div>
);

/**
 * LOCAL MODIFICATION: the drag handle on the item column's right edge.
 *
 * A window splitter, so it is a real focusable `separator` with arrow keys and
 * not a mouse-only affordance: the column holds truncated summaries, and
 * reading them must not require a pointer. The hit area is deliberately wider
 * than the 1px rule it sits on.
 */
export const GanttSidebarResizer: FC = () => {
  const gantt = useContext(GanttContext);
  const [dragging, setDragging] = useState(false);

  const widthFromPointer = (clientX: number) => {
    // The sidebar is `sticky left-0` inside the scroll container, so its left
    // edge IS the container's — no need to measure the sidebar itself (which
    // is sized from the width we're about to set).
    const left = gantt.ref?.current?.getBoundingClientRect().left ?? 0;
    return clientX - left;
  };

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") {
      gantt.resizeSidebar?.(gantt.sidebarWidth - step);
    } else if (event.key === "ArrowRight") {
      gantt.resizeSidebar?.(gantt.sidebarWidth + step);
    } else if (event.key === "Home") {
      gantt.resizeSidebar?.(SIDEBAR_MIN_WIDTH);
    } else if (event.key === "End") {
      gantt.resizeSidebar?.(SIDEBAR_MAX_WIDTH);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      aria-label="Resize the item column"
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuenow={gantt.sidebarWidth}
      className={cn(
        // Kept fully INSIDE the column: the sidebar is `overflow-clip`, so a
        // handle that straddled the border would have its outer half cut off.
        "absolute top-0 right-0 z-40 h-full w-2 cursor-col-resize touch-none outline-none",
        // The rule itself: invisible at rest, violet while grabbed or focused,
        // so the column edge stays a hairline until you reach for it.
        "after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:opacity-100",
        dragging && "after:opacity-100",
      )}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        // Capture so the drag survives the pointer leaving the 8px strip —
        // and so the bars underneath never see the move events.
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        gantt.resizeSidebar?.(widthFromPointer(event.clientX));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      role="separator"
      tabIndex={0}
    />
  );
};

export type GanttSidebarProps = {
  children: ReactNode;
  className?: string;
  /** Column heading over the item names — "Issues" upstream. */
  label?: string;
  /** LOCAL MODIFICATION: drag handle on the right edge. On by default. */
  resizable?: boolean;
};

export const GanttSidebar: FC<GanttSidebarProps> = ({
  children,
  className,
  label,
  resizable = true,
}) => (
  <div
    className={cn(
      // Opaque card, not a translucent blur: the timeline scrolls under it and
      // a 90%-alpha panel let the bars ghost through.
      "sticky left-0 z-30 h-max min-h-full overflow-clip border-border border-r bg-card",
      className,
    )}
    data-roadmap-ui="gantt-sidebar"
  >
    <GanttSidebarHeader label={label} />
    <div className="space-y-4">{children}</div>
    {resizable ? <GanttSidebarResizer /> : null}
  </div>
);

export type GanttAddFeatureHelperProps = {
  top: number;
  className?: string;
};

export const GanttAddFeatureHelper: FC<GanttAddFeatureHelperProps> = ({
  top,
  className,
}) => {
  const [scrollX] = useGanttScrollX();
  const gantt = useContext(GanttContext);
  const [mousePosition, mouseRef] = useMouse<HTMLDivElement>();

  const handleClick = () => {
    const ganttRect = gantt.ref?.current?.getBoundingClientRect();
    const x =
      mousePosition.x - (ganttRect?.left ?? 0) + scrollX - gantt.sidebarWidth;
    const currentDate = getDateByMousePosition(gantt, x);

    gantt.onAddItem?.(currentDate);
  };

  return (
    <div
      className={cn("absolute top-0 w-full px-0.5", className)}
      ref={mouseRef}
      style={{
        marginTop: -gantt.rowHeight / 2,
        transform: `translateY(${top}px)`,
      }}
    >
      <button
        className="flex h-full w-full items-center justify-center rounded-md border border-dashed p-2"
        onClick={handleClick}
        type="button"
      >
        <PlusIcon
          className="pointer-events-none select-none text-muted-foreground"
          size={16}
        />
      </button>
    </div>
  );
};

export type GanttColumnProps = {
  index: number;
  isColumnSecondary?: (item: number) => boolean;
};

export const GanttColumn: FC<GanttColumnProps> = ({
  index,
  isColumnSecondary,
}) => {
  const gantt = useContext(GanttContext);
  const [dragging] = useGanttDragging();
  const [mousePosition, mouseRef] = useMouse<HTMLDivElement>();
  const [hovering, setHovering] = useState(false);
  const [windowScroll] = useWindowScroll();

  const handleMouseEnter = () => setHovering(true);
  const handleMouseLeave = () => setHovering(false);

  const top = useThrottle(
    mousePosition.y -
      (mouseRef.current?.getBoundingClientRect().y ?? 0) -
      (windowScroll.y ?? 0),
    10,
  );

  return (
    <div
      className={cn(
        "group relative h-full overflow-hidden",
        // Neutral sunken fill for weekends — v0.3 keeps violet for interaction
        // only, so a tinted background here would read as "selected".
        isColumnSecondary?.(index) ? "bg-muted" : "",
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={mouseRef}
    >
      {!dragging && hovering && gantt.onAddItem ? (
        <GanttAddFeatureHelper top={top} />
      ) : null}
    </div>
  );
};

export type GanttColumnsProps = {
  columns: number;
  isColumnSecondary?: (item: number) => boolean;
};

export const GanttColumns: FC<GanttColumnsProps> = ({
  columns,
  isColumnSecondary,
}) => {
  const id = useId();

  return (
    <div
      className="grid h-full w-full divide-x divide-border"
      style={{
        gridTemplateColumns: `repeat(${columns}, var(--gantt-column-width))`,
      }}
    >
      {Array.from({ length: columns }).map((_, index) => (
        <GanttColumn
          index={index}
          isColumnSecondary={isColumnSecondary}
          key={`${id}-${index}`}
        />
      ))}
    </div>
  );
};

export type GanttCreateMarkerTriggerProps = {
  onCreateMarker: (date: Date) => void;
  className?: string;
};

export const GanttCreateMarkerTrigger: FC<GanttCreateMarkerTriggerProps> = ({
  onCreateMarker,
  className,
}) => {
  const gantt = useContext(GanttContext);
  const [mousePosition, mouseRef] = useMouse<HTMLDivElement>();
  const [windowScroll] = useWindowScroll();
  const x = useThrottle(
    mousePosition.x -
      (mouseRef.current?.getBoundingClientRect().x ?? 0) -
      (windowScroll.x ?? 0),
    10,
  );

  const date = getDateByMousePosition(gantt, x);

  const handleClick = () => onCreateMarker(date);

  return (
    <div
      className={cn(
        "group pointer-events-none absolute top-0 left-0 h-full w-full select-none overflow-visible",
        className,
      )}
      ref={mouseRef}
    >
      <div
        className="-ml-2 pointer-events-auto sticky top-6 z-20 flex w-4 flex-col items-center justify-center gap-1 overflow-visible opacity-0 group-hover:opacity-100"
        style={{ transform: `translateX(${x}px)` }}
      >
        <button
          className="z-50 inline-flex h-4 w-4 items-center justify-center rounded-full bg-card"
          onClick={handleClick}
          type="button"
        >
          <PlusIcon className="text-muted-foreground" size={12} />
        </button>
        <div className="whitespace-nowrap rounded-full border border-border bg-popover px-2 py-1 text-foreground text-xs shadow-pop">
          {formatDate(date, "MMM dd, yyyy")}
        </div>
      </div>
    </div>
  );
};

export type GanttFeatureDragHelperProps = {
  featureId: GanttFeature["id"];
  direction: "left" | "right";
  date: Date | null;
};

export const GanttFeatureDragHelper: FC<GanttFeatureDragHelperProps> = ({
  direction,
  featureId,
  date,
}) => {
  const [, setDragging] = useGanttDragging();
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `feature-drag-helper-${featureId}`,
  });

  const isPressed = Boolean(attributes["aria-pressed"]);

  useEffect(() => setDragging(isPressed), [isPressed, setDragging]);

  return (
    <div
      className={cn(
        "group -translate-y-1/2 !cursor-col-resize absolute top-1/2 z-[3] h-full w-6 rounded-md outline-none",
        direction === "left" ? "-left-2.5" : "-right-2.5",
      )}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
    >
      <div
        className={cn(
          "-translate-y-1/2 absolute top-1/2 h-[80%] w-1 rounded-sm bg-border opacity-0 transition-all",
          direction === "left" ? "left-2.5" : "right-2.5",
          direction === "left" ? "group-hover:left-0" : "group-hover:right-0",
          isPressed && (direction === "left" ? "left-0" : "right-0"),
          "group-hover:opacity-100",
          isPressed && "opacity-100",
        )}
      />
      {date && (
        <div
          className={cn(
            "-translate-x-1/2 absolute top-10 hidden whitespace-nowrap rounded-lg border border-border bg-popover px-2 py-1 text-foreground text-xs shadow-pop group-hover:block",
            isPressed && "block",
          )}
        >
          {format(date, "MMM dd, yyyy")}
        </div>
      )}
    </div>
  );
};

export type GanttFeatureItemCardProps = Pick<GanttFeature, "id"> & {
  children?: ReactNode;
  status?: GanttStatus;
};

export const GanttFeatureItemCard: FC<GanttFeatureItemCardProps> = ({
  id,
  status,
  children,
}) => {
  const [, setDragging] = useGanttDragging();
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  const isPressed = Boolean(attributes["aria-pressed"]);

  useEffect(() => setDragging(isPressed), [isPressed, setDragging]);

  // LOCAL MODIFICATION: upstream renders a plain white card, so the bar carried
  // no status at all. The status colour arrives as data (an inline value, not a
  // token), so it's mixed against --card into a soft tint with a solid rail —
  // legible ink text in both themes, where a saturated fill would fail contrast
  // for amber. Colour is never the only signal: the sidebar dot, the bar label
  // and the list fallback all still name the sprint.
  const color = status?.color ?? "var(--primary)";

  return (
    <div
      className="flex h-full w-full items-center overflow-hidden rounded-sm border shadow-card"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 16%, var(--card))`,
        borderColor: `color-mix(in oklab, ${color} 42%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-full w-1 shrink-0"
        style={{ backgroundColor: color }}
      />
      <div
        className={cn(
          "flex h-full w-full items-center justify-between gap-2 px-2 text-left font-semibold text-foreground text-xs",
          isPressed ? "cursor-grabbing" : "cursor-grab",
        )}
        {...attributes}
        {...listeners}
        ref={setNodeRef}
      >
        {children}
      </div>
    </div>
  );
};

export type GanttFeatureItemProps = GanttFeature & {
  /**
   * Called once a drag or resize settles, with the dates it landed on. May
   * return a promise: the bar holds its dragged position until that promise
   * settles and then falls back to whatever the props now say, so a save that
   * was clamped, rejected or rolled back is visible on the chart.
   */
  onMove?: (
    id: string,
    startDate: Date,
    endDate: Date | null,
  ) => void | Promise<void>;
  children?: ReactNode;
  className?: string;
};

export const GanttFeatureItem: FC<GanttFeatureItemProps> = ({
  onMove,
  children,
  className,
  ...feature
}) => {
  const gantt = useContext(GanttContext);
  const timelineStartDate = useMemo(
    () => new Date(gantt.timelineData.at(0)?.year ?? 0, 0, 1),
    [gantt.timelineData],
  );

  /**
   * LOCAL MODIFICATION — the bar's dates are PROPS, and only a live drag can
   * override them.
   *
   * Upstream seeded `useState` from the props and thereafter only ever wrote to
   * it from the drag handlers, so a bar was a one-way copy of its owner: once
   * dragged it ignored every later correction for the rest of its life. A
   * server that clamped the range, a parent that rolled the dates back after a
   * failed save, an edit made in the item's own dialog — none of it moved the
   * bar, and the chart drifted away from the data it was drawing.
   *
   * So the gesture keeps a `draft` instead, and the draft is dropped the moment
   * the move settles or the props move underneath it, whichever comes first.
   */
  const [draft, setDraft] = useState<{
    startAt: Date;
    endAt: Date | null;
  } | null>(null);

  const propDates = `${feature.startAt.getTime()}:${feature.endAt?.getTime() ?? ""}`;
  const [renderedFrom, setRenderedFrom] = useState(propDates);

  if (renderedFrom !== propDates) {
    // Adjusting state during render is the supported pattern here — an effect
    // would paint the stale bar for a frame first. Compared by time value, not
    // by identity: a parent that rebuilds its `Date`s every render must not
    // count as a change.
    setRenderedFrom(propDates);
    setDraft(null);
  }

  const startAt = draft ? draft.startAt : feature.startAt;
  const endAt = draft ? draft.endAt : feature.endAt;

  // Memoize expensive calculations
  const width = useMemo(
    () => getWidth(startAt, endAt, timelineStartDate, gantt),
    [startAt, endAt, timelineStartDate, gantt],
  );
  const offset = useMemo(
    () => getOffset(startAt, timelineStartDate, gantt),
    [startAt, timelineStartDate, gantt],
  );

  const addRange = useMemo(() => getAddRange(gantt.range), [gantt.range]);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 10,
    },
  });

  /**
   * Where the bar's edges were when the gesture began. A drag is measured from
   * HERE plus dnd-kit's own horizontal delta.
   *
   * LOCAL MODIFICATION: upstream converted the raw page mouse position into a
   * date, an origin that has nothing to do with the timeline's — the sidebar's
   * width and the horizontal scroll both sit between them, and the resize
   * handlers subtracted them while the body drag did not. Since the pixel→date
   * mapping is only piecewise linear (a column is a month in the monthly
   * ranges, so its days-per-pixel changes every column), reading it at the
   * wrong x gave the wrong number of days: the bar and the dates it then
   * reported disagreed, by more the further the chart was scrolled.
   */
  const dragOrigin = useRef<{ startAt: Date; endAt: Date | null } | null>(null);

  const handleDragStart = useCallback(() => {
    dragOrigin.current = { startAt, endAt };
  }, [startAt, endAt]);

  /**
   * Whole days between `edge` and where `delta` pixels of drag put it. Both
   * ends of the subtraction go through the axis, so the answer is what the
   * pointer is actually over rather than a pixel count divided by a guess.
   */
  const draggedDays = useCallback(
    (edge: Date, delta: number) =>
      differenceInCalendarDays(
        getDateByMousePosition(
          gantt,
          getOffset(edge, timelineStartDate, gantt) + delta,
        ),
        edge,
      ),
    [gantt, timelineStartDate],
  );

  const handleItemDragMove = useCallback(
    (event: DragMoveEvent) => {
      const origin = dragOrigin.current;

      if (!origin) {
        return;
      }

      // Shift both edges by the same whole number of days: moving a bar never
      // changes its length. Adding days to the ORIGINAL dates also preserves
      // the noon-pinned time our date-only helpers rely on.
      const days = draggedDays(origin.startAt, event.delta.x);

      setDraft({
        startAt: addDays(origin.startAt, days),
        endAt: origin.endAt ? addDays(origin.endAt, days) : null,
      });
    },
    [draggedDays],
  );

  const handleLeftDragMove = useCallback(
    (event: DragMoveEvent) => {
      const origin = dragOrigin.current;

      if (!origin) {
        return;
      }

      const next = addDays(
        origin.startAt,
        draggedDays(origin.startAt, event.delta.x),
      );

      setDraft({
        // A handle dragged past the far edge is a mis-drop, not an instruction
        // to invert the range — clamp it rather than draw a backwards bar and
        // report dates the owner has to silently correct.
        startAt: origin.endAt && next > origin.endAt ? origin.endAt : next,
        endAt: origin.endAt,
      });
    },
    [draggedDays],
  );

  const handleRightDragMove = useCallback(
    (event: DragMoveEvent) => {
      const origin = dragOrigin.current;

      if (!origin) {
        return;
      }

      // The grabbed edge is the bar's right side, which is drawn at the START
      // of the day after `endAt` (see getWidth) — so the drag is measured
      // there and the result applied back to the inclusive end date.
      const end = origin.endAt ?? addRange(origin.startAt, 2);
      const next = addDays(end, draggedDays(addDays(end, 1), event.delta.x));

      setDraft({
        startAt: origin.startAt,
        endAt: next < origin.startAt ? origin.startAt : next,
      });
    },
    [addRange, draggedDays],
  );

  const handleDragEnd = useCallback(() => {
    dragOrigin.current = null;

    if (!draft) {
      return;
    }

    const unchanged =
      draft.startAt.getTime() === feature.startAt.getTime() &&
      (draft.endAt?.getTime() ?? null) === (feature.endAt?.getTime() ?? null);

    if (unchanged) {
      setDraft(null);
      return;
    }

    const settling = onMove?.(feature.id, draft.startAt, draft.endAt);

    // Hold the dragged position while the owner saves — snapping back
    // mid-flight would read as a glitch — then drop it either way, so a
    // rejected move can't strand the bar somewhere the data never went. An
    // owner that answers synchronously is covered by the props resync above.
    if (settling) {
      const release = () => setDraft(null);
      settling.then(release, release);
    }
  }, [draft, feature.id, feature.startAt, feature.endAt, onMove]);

  return (
    <div
      className={cn("relative flex w-max min-w-full py-0.5", className)}
      style={{ height: "var(--gantt-row-height)" }}
    >
      <div
        className="pointer-events-auto absolute top-0.5"
        style={{
          height: "calc(var(--gantt-row-height) - 4px)",
          width: Math.round(width),
          left: Math.round(offset),
        }}
      >
        {onMove && (
          <DndContext
            modifiers={[restrictToHorizontalAxis]}
            onDragEnd={handleDragEnd}
            onDragMove={handleLeftDragMove}
            // Every gesture needs the origin, not just the body drag: without
            // it a resize measured its delta from nothing.
            onDragStart={handleDragStart}
            sensors={[mouseSensor]}
          >
            <GanttFeatureDragHelper
              date={startAt}
              direction="left"
              featureId={feature.id}
            />
          </DndContext>
        )}
        <DndContext
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
          onDragMove={handleItemDragMove}
          onDragStart={handleDragStart}
          sensors={[mouseSensor]}
        >
          <GanttFeatureItemCard id={feature.id} status={feature.status}>
            {children ?? (
              <p className="flex-1 truncate text-xs">{feature.name}</p>
            )}
          </GanttFeatureItemCard>
        </DndContext>
        {onMove && (
          <DndContext
            modifiers={[restrictToHorizontalAxis]}
            onDragEnd={handleDragEnd}
            onDragMove={handleRightDragMove}
            onDragStart={handleDragStart}
            sensors={[mouseSensor]}
          >
            <GanttFeatureDragHelper
              date={endAt ?? addRange(startAt, 2)}
              direction="right"
              featureId={feature.id}
            />
          </DndContext>
        )}
      </div>
    </div>
  );
};

export type GanttFeatureListGroupProps = {
  children: ReactNode;
  className?: string;
};

export const GanttFeatureListGroup: FC<GanttFeatureListGroupProps> = ({
  children,
  className,
}) => (
  <div className={className} style={{ paddingTop: "var(--gantt-row-height)" }}>
    {children}
  </div>
);

export type GanttFeatureRowProps = {
  features: GanttFeature[];
  onMove?: (
    id: string,
    startAt: Date,
    endAt: Date | null,
  ) => void | Promise<void>;
  children?: (feature: GanttFeature) => ReactNode;
  className?: string;
};

export const GanttFeatureRow: FC<GanttFeatureRowProps> = ({
  features,
  onMove,
  children,
  className,
}) => {
  // Sort features by start date to handle potential overlaps
  const sortedFeatures = [...features].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  // Calculate sub-row positions for overlapping features using a proper algorithm
  const featureWithPositions = [];
  const subRowEndTimes: Date[] = []; // Track when each sub-row becomes free

  for (const feature of sortedFeatures) {
    let subRow = 0;

    // Find the first sub-row that's free (doesn't overlap)
    while (
      subRow < subRowEndTimes.length &&
      subRowEndTimes[subRow] > feature.startAt
    ) {
      subRow++;
    }

    // Update the end time for this sub-row
    if (subRow === subRowEndTimes.length) {
      subRowEndTimes.push(feature.endAt);
    } else {
      subRowEndTimes[subRow] = feature.endAt;
    }

    featureWithPositions.push({ ...feature, subRow });
  }

  const maxSubRows = Math.max(1, subRowEndTimes.length);
  const subRowHeight = 36; // Base row height

  return (
    <div
      className={cn("relative", className)}
      style={{
        height: `${maxSubRows * subRowHeight}px`,
        minHeight: "var(--gantt-row-height)",
      }}
    >
      {featureWithPositions.map((feature) => (
        <div
          className="absolute w-full"
          key={feature.id}
          style={{
            top: `${feature.subRow * subRowHeight}px`,
            height: `${subRowHeight}px`,
          }}
        >
          <GanttFeatureItem {...feature} onMove={onMove}>
            {children ? (
              children(feature)
            ) : (
              <p className="flex-1 truncate text-xs">{feature.name}</p>
            )}
          </GanttFeatureItem>
        </div>
      ))}
    </div>
  );
};

export type GanttFeatureListProps = {
  className?: string;
  children: ReactNode;
};

export const GanttFeatureList: FC<GanttFeatureListProps> = ({
  className,
  children,
}) => (
  <div
    className={cn("absolute top-0 left-0 h-full w-max space-y-4", className)}
    style={{ marginTop: "var(--gantt-header-height)" }}
  >
    {children}
  </div>
);

export const GanttMarker: FC<
  GanttMarkerProps & {
    onRemove?: (id: string) => void;
    className?: string;
  }
> = memo(({ label, date, id, onRemove, className }) => {
  const gantt = useContext(GanttContext);
  const differenceIn = useMemo(
    () => getDifferenceIn(gantt.range),
    [gantt.range],
  );
  const timelineStartDate = useMemo(
    () => new Date(gantt.timelineData.at(0)?.year ?? 0, 0, 1),
    [gantt.timelineData],
  );

  // Memoize expensive calculations. The weekly grid is 7-day blocks counted
  // from the timeline start, which no whole-column + offset-inside-the-calendar
  // -week pair describes — so it is placed straight off getOffset instead.
  const weekly = gantt.range === "weekly";
  const offset = useMemo(
    () => (weekly ? 0 : differenceIn(date, timelineStartDate)),
    [weekly, differenceIn, date, timelineStartDate],
  );
  const innerOffset = useMemo(
    () =>
      weekly
        ? getOffset(date, timelineStartDate, gantt)
        : calculateInnerOffset(
            date,
            gantt.range,
            (gantt.columnWidth * gantt.zoom) / 100,
          ),
    [weekly, date, timelineStartDate, gantt],
  );

  const handleRemove = useCallback(() => onRemove?.(id), [onRemove, id]);

  return (
    <div
      className="pointer-events-none absolute top-0 left-0 z-20 flex h-full select-none flex-col items-center justify-center overflow-visible"
      style={{
        width: 0,
        transform: `translateX(calc(var(--gantt-column-width) * ${offset} + ${innerOffset}px))`,
      }}
    >
      <ContextMenu>
        {/* LOCAL MODIFICATION: upstream wraps a <div> with `asChild`, which is
            a Radix API. This project's context menu is Base UI, where the
            trigger already renders a div and composition goes through `render`
            — so the classes move onto the trigger itself. */}
        <ContextMenuTrigger
          className={cn(
            // Non-working days are context, not the subject: neutral chip and
            // a hairline, so they never out-shout a sprint bar or today.
            "group pointer-events-auto sticky top-0 flex max-w-32 select-auto flex-col flex-nowrap items-center justify-center truncate whitespace-nowrap rounded-b-sm bg-muted px-2 py-1 text-[11px] text-foreground",
            className,
          )}
        >
          {label}
          <span className="max-h-0 overflow-hidden transition-all group-hover:max-h-8">
            {formatDate(date, "MMM dd, yyyy")}
          </span>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {onRemove ? (
            <ContextMenuItem
              className="flex items-center gap-2 text-destructive"
              onClick={handleRemove}
            >
              <TrashIcon size={16} />
              Remove marker
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      <div className={cn("h-full w-px bg-border", className)} />
    </div>
  );
});

GanttMarker.displayName = "GanttMarker";

export type GanttProviderProps = {
  range?: Range;
  zoom?: number;
  onAddItem?: (date: Date) => void;
  children: ReactNode;
  className?: string;
  /** Filled with a {@link GanttApi} while mounted, for controls outside the chart. */
  apiRef?: RefObject<GanttApi | null>;
};

export const GanttProvider: FC<GanttProviderProps> = ({
  zoom = 100,
  range = "monthly",
  onAddItem,
  children,
  className,
  apiRef,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [timelineData, setTimelineData] = useState<TimelineData>(
    createInitialTimelineData(new Date()),
  );
  const [, setScrollX] = useGanttScrollX();
  const [sidebarWidth, setSidebarWidth] = useState(0);
  // Sticky once dragged: the responsive default below is a starting point, not
  // a preference, so it must stop writing over a width the user chose.
  const sidebarResized = useRef(false);

  const resizeSidebar = useCallback((width: number) => {
    sidebarResized.current = true;
    setSidebarWidth(
      Math.round(
        Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH),
      ),
    );
  }, []);

  const headerHeight = 60;
  const rowHeight = 36;
  let columnWidth = 50;

  if (range === "monthly") {
    columnWidth = 150;
  } else if (range === "quarterly") {
    columnWidth = 100;
  } else if (range === "weekly") {
    // Wide enough for a "13 Sept" column label without truncating.
    columnWidth = 78;
  }

  // Memoize CSS variables to prevent unnecessary re-renders
  const cssVariables = useMemo(
    () =>
      ({
        "--gantt-zoom": `${zoom}`,
        "--gantt-column-width": `${(zoom / 100) * columnWidth}px`,
        "--gantt-header-height": `${headerHeight}px`,
        "--gantt-row-height": `${rowHeight}px`,
        "--gantt-sidebar-width": `${sidebarWidth}px`,
      }) as CSSProperties,
    [zoom, columnWidth, sidebarWidth],
  );

  // Keep the latest timeline data reachable from the centring effect below
  // without making it a dependency: the infinite-scroll handler rewrites it
  // while the user scrolls, and re-centring then would yank the view back.
  const timelineDataRef = useRef(timelineData);
  timelineDataRef.current = timelineData;

  // LOCAL MODIFICATION: centre the viewport on a date. Used both to open on
  // today (upstream scrolled to `scrollWidth / 2`, but the scroll width
  // includes the sidebar column and the span is three calendar years, so the
  // midpoint lands months before now — today and anything scheduled around it
  // ended up jammed against the right edge) and by the "Today" control that
  // brings the view back after the user has scrolled away.
  const scrollToDate = useCallback(
    (date: Date, behavior: ScrollBehavior = "smooth") => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) {
        return;
      }

      const data = timelineDataRef.current;
      const timelineStartDate = new Date(data.at(0)?.year ?? 0, 0, 1);
      const offset = getOffset(date, timelineStartDate, {
        zoom,
        range,
        columnWidth,
        sidebarWidth,
        headerHeight,
        rowHeight,
        onAddItem,
        placeholderLength: 2,
        timelineData: data,
        ref: scrollRef,
      });

      const viewportWidth = Math.max(
        0,
        scrollElement.clientWidth - sidebarWidth,
      );
      const maxScrollLeft = Math.max(
        0,
        scrollElement.scrollWidth - scrollElement.clientWidth,
      );
      const targetScrollLeft = Math.min(
        Math.max(offset - viewportWidth / 2, 0),
        maxScrollLeft,
      );

      // A smooth scroll is motion like any other — reduced-motion users get
      // the jump instead.
      const reduced = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      scrollElement.scrollTo({
        left: targetScrollLeft,
        behavior: reduced ? "auto" : behavior,
      });
      setScrollX(targetScrollLeft);
    },
    [zoom, range, columnWidth, sidebarWidth, onAddItem, setScrollX],
  );

  /** The axis scale the viewport was last centred for — see the effect below. */
  const centredForRef = useRef<string | null>(null);

  // Open on today, and re-centre when the column width changes under a new
  // range so the view doesn't drift off to an unrelated year.
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    // sidebarWidth is measured in a separate effect; centring before it lands
    // would be off by the sidebar's width.
    const hasSidebar = Boolean(
      scrollElement.querySelector('[data-roadmap-ui="gantt-sidebar"]'),
    );
    if (hasSidebar && sidebarWidth === 0) {
      return;
    }

    // Re-centre when the AXIS rescales, not whenever `scrollToDate` changes
    // identity: it closes over `sidebarWidth`, so without this key every pixel
    // of a resize drag would yank the view back to today.
    const key = `${range}:${columnWidth}:${zoom}`;
    if (centredForRef.current === key) {
      return;
    }
    centredForRef.current = key;

    scrollToDate(new Date(), "auto");
  }, [scrollToDate, sidebarWidth, range, columnWidth, zoom]);

  useEffect(() => {
    if (!apiRef) {
      return;
    }

    apiRef.current = { scrollToDate };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef, scrollToDate]);

  // Update sidebar width when DOM is ready
  useEffect(() => {
    const updateSidebarWidth = () => {
      const sidebarElement = scrollRef.current?.querySelector(
        '[data-roadmap-ui="gantt-sidebar"]',
      );

      if (!sidebarElement) {
        setSidebarWidth(0);
        return;
      }

      // LOCAL MODIFICATION: upstream pins 300px, which eats most of the
      // timeline inside this app's ~1024px content column and leaves almost
      // nothing on a phone. The sidebar column is sized *from* this number
      // (--gantt-sidebar-width), so it can't be measured — it's a breakpoint.
      if (!sidebarResized.current) {
        setSidebarWidth(window.innerWidth < 640 ? 152 : 232);
        return;
      }

      // A dragged width survives the resize, but not at the cost of the axis:
      // narrowing the window past it hands the chart its floor back.
      const available = scrollRef.current?.clientWidth ?? 0;
      const ceiling = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, available - 160),
      );
      setSidebarWidth((current) => Math.min(current, ceiling));
    };

    // Update immediately
    updateSidebarWidth();

    // Also update on resize or when children change
    const observer = new MutationObserver(updateSidebarWidth);
    if (scrollRef.current) {
      observer.observe(scrollRef.current, {
        childList: true,
        subtree: true,
      });
    }

    window.addEventListener("resize", updateSidebarWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSidebarWidth);
    };
  }, []);

  // Fix the useCallback to include all dependencies
  const handleScroll = useCallback(
    throttle(() => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) {
        return;
      }

      const { scrollLeft, scrollWidth, clientWidth } = scrollElement;
      setScrollX(scrollLeft);

      if (scrollLeft === 0) {
        // Extend timelineData to the past
        const firstYear = timelineData[0]?.year;

        if (!firstYear) {
          return;
        }

        const newTimelineData: TimelineData = [...timelineData];
        newTimelineData.unshift({
          year: firstYear - 1,
          quarters: new Array(4).fill(null).map((_, quarterIndex) => ({
            months: new Array(3).fill(null).map((_, monthIndex) => {
              const month = quarterIndex * 3 + monthIndex;
              return {
                days: getDaysInMonth(new Date(firstYear, month, 1)),
              };
            }),
          })),
        });

        setTimelineData(newTimelineData);

        // Scroll a bit forward so it's not at the very start
        scrollElement.scrollLeft = scrollElement.clientWidth;
        setScrollX(scrollElement.scrollLeft);
      } else if (scrollLeft + clientWidth >= scrollWidth) {
        // Extend timelineData to the future
        const lastYear = timelineData.at(-1)?.year;

        if (!lastYear) {
          return;
        }

        const newTimelineData: TimelineData = [...timelineData];
        newTimelineData.push({
          year: lastYear + 1,
          quarters: new Array(4).fill(null).map((_, quarterIndex) => ({
            months: new Array(3).fill(null).map((_, monthIndex) => {
              const month = quarterIndex * 3 + monthIndex;
              return {
                days: getDaysInMonth(new Date(lastYear, month, 1)),
              };
            }),
          })),
        });

        setTimelineData(newTimelineData);

        // Scroll a bit back so it's not at the very end
        scrollElement.scrollLeft =
          scrollElement.scrollWidth - scrollElement.clientWidth;
        setScrollX(scrollElement.scrollLeft);
      }
    }, 100),
    [],
  );

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      scrollElement.addEventListener("scroll", handleScroll);
    }

    return () => {
      // Fix memory leak by properly referencing the scroll element
      if (scrollElement) {
        scrollElement.removeEventListener("scroll", handleScroll);
      }
    };
  }, [handleScroll]);

  const scrollToFeature = useCallback(
    (feature: GanttFeature) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) {
        return;
      }

      // Calculate timeline start date from timelineData
      const timelineStartDate = new Date(timelineData[0].year, 0, 1);

      // Calculate the horizontal offset for the feature's start date
      const offset = getOffset(feature.startAt, timelineStartDate, {
        zoom,
        range,
        columnWidth,
        sidebarWidth,
        headerHeight,
        rowHeight,
        onAddItem,
        placeholderLength: 2,
        timelineData,
        ref: scrollRef,
      });

      // Scroll to align the feature's start with the right side of the sidebar
      const targetScrollLeft = Math.max(0, offset);

      scrollElement.scrollTo({
        left: targetScrollLeft,
        behavior: "smooth",
      });
    },
    [timelineData, zoom, range, columnWidth, sidebarWidth, onAddItem],
  );

  return (
    <GanttContext.Provider
      value={{
        zoom,
        range,
        headerHeight,
        columnWidth,
        sidebarWidth,
        rowHeight,
        onAddItem,
        timelineData,
        placeholderLength: 2,
        ref: scrollRef,
        scrollToFeature,
        scrollToDate,
        resizeSidebar,
      }}
    >
      <div
        className={cn(
          "gantt relative isolate grid h-full w-full flex-none select-none overflow-auto bg-card",
          range,
          className,
        )}
        ref={scrollRef}
        style={{
          ...cssVariables,
          gridTemplateColumns: "var(--gantt-sidebar-width) 1fr",
        }}
      >
        {children}
      </div>
    </GanttContext.Provider>
  );
};

export type GanttTimelineProps = {
  children: ReactNode;
  className?: string;
};

export const GanttTimeline: FC<GanttTimelineProps> = ({
  children,
  className,
}) => (
  <div
    className={cn(
      "relative flex h-full w-max flex-none overflow-clip",
      className,
    )}
  >
    {children}
  </div>
);

export type GanttTodayProps = {
  className?: string;
};

export const GanttToday: FC<GanttTodayProps> = ({ className }) => {
  const label = "Today";
  const date = useMemo(() => new Date(), []);
  const gantt = useContext(GanttContext);
  const differenceIn = useMemo(
    () => getDifferenceIn(gantt.range),
    [gantt.range],
  );
  const timelineStartDate = useMemo(
    () => new Date(gantt.timelineData.at(0)?.year ?? 0, 0, 1),
    [gantt.timelineData],
  );

  // Memoize expensive calculations. The weekly grid is 7-day blocks counted
  // from the timeline start, which no whole-column + offset-inside-the-calendar
  // -week pair describes — so it is placed straight off getOffset instead.
  const weekly = gantt.range === "weekly";
  const offset = useMemo(
    () => (weekly ? 0 : differenceIn(date, timelineStartDate)),
    [weekly, differenceIn, date, timelineStartDate],
  );
  const innerOffset = useMemo(
    () =>
      weekly
        ? getOffset(date, timelineStartDate, gantt)
        : calculateInnerOffset(
            date,
            gantt.range,
            (gantt.columnWidth * gantt.zoom) / 100,
          ),
    [weekly, date, timelineStartDate, gantt],
  );

  return (
    <div
      className="pointer-events-none absolute top-0 left-0 z-20 flex h-full select-none flex-col items-center justify-center overflow-visible"
      style={{
        width: 0,
        transform: `translateX(calc(var(--gantt-column-width) * ${offset} + ${innerOffset}px))`,
      }}
    >
      <div
        className={cn(
          // The one violet moment in the chart — today is the reference line
          // everything else is read against.
          "group pointer-events-auto sticky top-0 flex select-auto flex-col flex-nowrap items-center justify-center whitespace-nowrap rounded-b-sm bg-primary px-2 py-1 font-bold text-[11px] text-primary-foreground uppercase tracking-[0.09em] shadow-card",
          className,
        )}
      >
        {label}
        <span className="max-h-[0] overflow-hidden font-normal normal-case tracking-normal opacity-90 transition-all group-hover:max-h-[2rem]">
          {formatDate(date, "MMM dd, yyyy")}
        </span>
      </div>
      <div className={cn("h-full w-px bg-primary", className)} />
    </div>
  );
};
