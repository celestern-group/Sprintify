"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type {
  OverviewBurnDownPoint,
  OverviewCategoryCount,
  OverviewFlowPoint,
} from "@/lib/actions/project-overview";

// The overview's two heroes. Both follow the same accessibility rule: the
// drawing carries `role="img"` and a sentence that says what it says, and the
// panel around it prints the same numbers as text — the chart is never the
// only way to read the data, and never distinguishes a series by hue alone
// (created is dashed, completed is filled).

const flowConfig = {
  completed: { label: "Completed", color: "var(--chart-1)" },
  created: { label: "Created", color: "var(--chart-2)" },
} satisfies ChartConfig;

const burnDownConfig = {
  remaining: { label: "Remaining", color: "var(--chart-1)" },
  ideal: { label: "Ideal", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** Current sprint's remaining committed estimate against the ideal pace. */
export function BurnDownChart({
  data,
  unitLabel,
}: {
  data: OverviewBurnDownPoint[];
  unitLabel: string;
}) {
  const latest = data.at(-1);
  const initial = data[0]?.remaining ?? 0;

  return (
    <ChartContainer
      config={burnDownConfig}
      className="aspect-auto h-[220px] w-full"
      role="img"
      aria-label={`Sprint burn-down: ${latest?.remaining ?? 0} ${unitLabel} remaining from ${initial} committed. The ideal pace is ${latest?.ideal ?? 0} ${unitLabel}.`}
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ left: 4, right: 8, top: 8 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 6" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={24}
        />
        <YAxis
          width={32}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Line
          dataKey="ideal"
          type="linear"
          stroke="var(--color-ideal)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
        />
        <Line
          dataKey="remaining"
          type="monotone"
          stroke="var(--color-remaining)"
          strokeWidth={3}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

/** Created vs completed per week — the project's delivery flow. */
export function FlowChart({ data }: { data: OverviewFlowPoint[] }) {
  const created = data.reduce((sum, point) => sum + point.created, 0);
  const completed = data.reduce((sum, point) => sum + point.completed, 0);

  return (
    <ChartContainer
      config={flowConfig}
      className="aspect-auto h-[208px] w-full"
      role="img"
      aria-label={`Weekly flow over the last ${data.length} weeks: ${created} items created, ${completed} completed.`}
    >
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ left: 4, right: 8, top: 8 }}
      >
        <defs>
          <linearGradient id="overviewFillDone" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-completed)"
              stopOpacity={0.3}
            />
            <stop
              offset="100%"
              stopColor="var(--color-completed)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 6" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={24}
        />
        <YAxis
          width={28}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Area
          dataKey="created"
          type="monotone"
          stroke="var(--color-created)"
          strokeWidth={2.5}
          strokeDasharray="4 4"
          fill="transparent"
        />
        <Area
          dataKey="completed"
          type="monotone"
          stroke="var(--color-completed)"
          strokeWidth={3}
          fill="url(#overviewFillDone)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

const statusConfig = {
  todo: { label: "To do", color: "var(--chart-1)" },
  in_progress: { label: "In progress", color: "var(--chart-2)" },
  done: { label: "Done", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Donut of the three workflow categories, total in the middle. */
export function StatusDonut({
  slices,
  centerLabel,
}: {
  slices: OverviewCategoryCount[];
  centerLabel: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const data = slices.map((slice) => ({
    key: slice.category,
    name: statusConfig[slice.category].label,
    value: slice.count,
  }));

  return (
    <ChartContainer
      config={statusConfig}
      className="aspect-square h-[180px] w-full"
      role="img"
      aria-label={`${total} items: ${slices
        .map((slice) => `${slice.count} ${statusConfig[slice.category].label}`)
        .join(", ")}.`}
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent nameKey="name" hideLabel />}
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={54}
          outerRadius={80}
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((slice) => (
            <Cell key={slice.key} fill={`var(--color-${slice.key})`} />
          ))}
          <Label
            position="center"
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox)) return null;
              const cx = viewBox.cx ?? 0;
              const cy = viewBox.cy ?? 0;
              return (
                <text x={cx} y={cy} textAnchor="middle">
                  <tspan
                    x={cx}
                    y={cy - 4}
                    className="fill-foreground text-2xl font-extrabold tabular-nums"
                  >
                    {total}
                  </tspan>
                  <tspan
                    x={cx}
                    y={cy + 16}
                    className="fill-muted-foreground text-[11px] font-bold tracking-[0.09em] uppercase"
                  >
                    {centerLabel}
                  </tspan>
                </text>
              );
            }}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
