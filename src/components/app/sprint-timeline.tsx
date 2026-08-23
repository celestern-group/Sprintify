"use client";

import { CrosshairIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  type GanttApi,
  GanttFeatureItem,
  GanttFeatureList,
  GanttFeatureListGroup,
  GanttHeader,
  GanttMarker,
  GanttProvider,
  GanttSidebar,
  GanttSidebarGroup,
  GanttSidebarItem,
  GanttTimeline,
  GanttToday,
  type Range,
} from "@/components/kibo-ui/gantt";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { SprintState } from "@/db/schema/sprints";
import { usePersistedChoice } from "@/hooks/use-persisted-state";
import type { SprintSummary } from "@/lib/actions/sprints";
import { moveSprint } from "@/lib/actions/sprints";
import { formatIsoShort } from "@/lib/date-only";
import {
  featureToDates,
  holidaysToMarkers,
  sprintToFeature,
} from "@/lib/gantt-adapter";

const RANGES: { value: Range; label: string }[] = [
  { value: "daily", label: "Days" },
  { value: "weekly", label: "Weeks" },
  { value: "monthly", label: "Months" },
  { value: "quarterly", label: "Quarters" },
];

/** The same set as a plain value list — what the stored zoom is checked against. */
const RANGE_VALUES: readonly Range[] = RANGES.map((entry) => entry.value);

// Lane order is the sprint lifecycle: what's running now, what's queued, then
// the archive. Colours match STATE_STATUS in gantt-adapter.
const LANES: { state: SprintState; name: string; color: string }[] = [
  { state: "active", name: "Active", color: "#6d4aff" },
  { state: "planning", name: "Planning", color: "#ff930a" },
  { state: "completed", name: "Completed", color: "#6f6f77" },
];

/**
 * When the sprints happen, on one axis, with the org's non-working days marked
 * so a sprint isn't scheduled over a shutdown week by accident.
 *
 * ACCESSIBILITY — read before changing this:
 *
 * The underlying Gantt now computes a drag from the pointer-event delta, so a
 * dnd-kit KeyboardSensor would no longer be inert — but it has never been wired
 * up or tested (no drag announcements, and the sensor's arrow-key step is a
 * pixel count, not a day), and a keyboard interaction that half works is worse
 * than not offering it. So drag stays a MOUSE-ONLY ENHANCEMENT, and every
 * sprint is also reachable and
 * reschedulable by keyboard through the sidebar item (a real focusable
 * control that opens the sprint) and the date fields in its edit dialog. That
 * dialog is the guaranteed path — do not remove it in favour of dragging.
 */
export function SprintTimeline({
  sprints,
  holidays,
  basePath,
  canReschedule,
}: {
  sprints: SprintSummary[];
  holidays: { date: string; name: string }[];
  basePath: string;
  canReschedule: boolean;
}) {
  const [range, setRange] = usePersistedChoice<Range>(
    "sprint-timeline.range",
    "monthly",
    RANGE_VALUES,
  );
  const ganttRef = useRef<GanttApi | null>(null);

  // `rows` exists only to hold the optimistic position of a bar mid-drag, so it
  // has to fall back in step with the server: a sprint created or rescheduled
  // elsewhere on the page arrives as a new `sprints` prop, and without this
  // resync the chart would keep rendering whatever list it mounted with.
  // Adjusting state during render is the supported pattern here — an effect
  // would paint the stale schedule for a frame first.
  const [rows, setRows] = useState(sprints);
  const [renderedFrom, setRenderedFrom] = useState(sprints);
  if (renderedFrom !== sprints) {
    setRenderedFrom(sprints);
    setRows(sprints);
  }

  const features = useMemo(
    () => rows.map((row) => sprintToFeature(row)),
    [rows],
  );
  const markers = useMemo(() => holidaysToMarkers(holidays), [holidays]);

  // Lanes read as the sprint lifecycle rather than one undifferentiated list —
  // and the lane name is what carries the state in the sidebar, so the bar
  // colour is never the only signal. Empty lanes are dropped so a young project
  // doesn't open on two empty headings.
  const lanes = useMemo(
    () =>
      LANES.map((lane) => ({
        ...lane,
        items: features.filter((feature) => feature.status.id === lane.state),
      })).filter((lane) => lane.items.length > 0),
    [features],
  );

  async function handleMove(id: string, startAt: Date, endAt: Date | null) {
    const current = rows.find((row) => row.id === id);
    if (!current) return;

    const next = featureToDates(startAt, endAt, {
      startDate: current.startDate,
      endDate: current.endDate,
    });

    // Optimistic: the bar has already moved under the cursor, so snapping it
    // back before the server answers would read as a glitch. A failure below
    // restores the original dates.
    setRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...next } : row)),
    );

    try {
      await moveSprint({ sprintId: id, ...next });
      toast.success(
        `${current.name} moved to ${formatIsoShort(next.startDate)} – ${formatIsoShort(next.endDate)}.`,
      );
    } catch (error) {
      setRows((previous) =>
        previous.map((row) => (row.id === id ? current : row)),
      );
      toast.error(
        error instanceof Error ? error.message : "Couldn't move that sprint.",
      );
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <fieldset className="flex items-center gap-1.5 border-0 p-0">
            {RANGES.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={option.value === range ? "secondary" : "outline"}
                aria-pressed={option.value === range}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </fieldset>
          <span
            aria-hidden="true"
            className="mx-0.5 hidden h-4 w-px bg-border sm:block"
          />
          {/* The chart opens centred on today, but nothing brought the view
              back once you'd scrolled off into next year. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => ganttRef.current?.scrollToDate(new Date())}
          >
            <CrosshairIcon aria-hidden="true" />
            Today
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {canReschedule
            ? "Drag a bar to reschedule, or open a sprint to edit its dates."
            : "Open a sprint to see its plan."}
        </p>
      </div>

      <div className="h-88 overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <GanttProvider
          range={range}
          zoom={100}
          className="h-full"
          apiRef={ganttRef}
        >
          <GanttSidebar label="Sprint">
            {lanes.map((lane) => (
              <GanttSidebarGroup key={lane.state} name={lane.name}>
                {lane.items.map((feature) => (
                  <GanttSidebarItem
                    key={feature.id}
                    feature={feature}
                    onSelectItem={(id) => {
                      window.location.href = `${basePath}/sprints/${id}`;
                    }}
                  />
                ))}
              </GanttSidebarGroup>
            ))}
          </GanttSidebar>
          <GanttTimeline>
            <GanttHeader />
            <GanttFeatureList>
              {lanes.map((lane) => (
                <GanttFeatureListGroup key={lane.state}>
                  {lane.items.map((feature) => (
                    <GanttFeatureItem
                      key={feature.id}
                      {...feature}
                      onMove={canReschedule ? handleMove : undefined}
                    >
                      <Link
                        href={`${basePath}/sprints/${feature.id}`}
                        className="flex-1 truncate text-xs"
                      >
                        {feature.name}
                      </Link>
                    </GanttFeatureItem>
                  ))}
                </GanttFeatureListGroup>
              ))}
            </GanttFeatureList>
            {markers.map((marker) => (
              <GanttMarker
                key={marker.id}
                id={marker.id}
                date={marker.date}
                label={marker.label}
              />
            ))}
            <GanttToday />
          </GanttTimeline>
        </GanttProvider>
      </div>

      {/* The bars carry a colour per state; this names them, so the chart is
          still readable under colour-vision deficiency. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {LANES.map((lane) => (
          <li key={lane.state} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: lane.color }}
            />
            {lane.name}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-px shrink-0 bg-primary" />
          Today
        </li>
        {markers.length > 0 ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
            Non-working day
          </li>
        ) : null}
      </ul>

      {/* Text alternative for the timeline — the bars are never the only way
          to read the schedule. */}
      <details>
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
          View the schedule as a list
        </summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm tabular-nums">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="font-semibold">{row.name}</span> —{" "}
              {formatIsoShort(row.startDate)} to {formatIsoShort(row.endDate)} (
              {row.state})
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
