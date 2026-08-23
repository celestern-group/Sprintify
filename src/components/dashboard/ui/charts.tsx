"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import type { ActivityPoint } from "@/components/dashboard/mock-data";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const activityConfig = {
  active: { label: "Members", color: "var(--chart-1)" },
  joined: { label: "Joined", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Gradient-fill area line — member growth over time. */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  return (
    <ChartContainer
      config={activityConfig}
      className="aspect-auto h-[220px] w-full"
    >
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillActive" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-active)"
              stopOpacity={0.28}
            />
            <stop
              offset="100%"
              stopColor="var(--color-active)"
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
          minTickGap={28}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Area
          dataKey="joined"
          type="monotone"
          stroke="var(--color-joined)"
          strokeWidth={2.5}
          strokeDasharray="4 4"
          fill="transparent"
        />
        <Area
          dataKey="active"
          type="monotone"
          stroke="var(--color-active)"
          strokeWidth={3}
          fill="url(#fillActive)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
