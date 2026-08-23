import {
  type Icon,
  IconArrowDownRight,
  IconArrowUpRight,
} from "@tabler/icons-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/* Brand keeps the signature violet tint; every other tone sits on the neutral
   chip surface with only the glyph coloured — the ~12% colour washes are
   retired (they vanished in light and muddied in dark). Same rule as badges:
   the surface never takes the hue. */
const iconTones = {
  brand: "bg-secondary text-secondary-foreground",
  blue: "bg-chip text-chart-2",
  success: "bg-chip text-success",
  amber: "bg-chip text-warning",
} as const;

export function DeltaBadge({
  up = true,
  children,
  className,
}: {
  up?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const Arrow = up ? IconArrowUpRight : IconArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
        up ? "bg-success-tint text-success" : "bg-danger-tint text-destructive",
        className,
      )}
    >
      <Arrow className="size-3" />
      {children}
    </span>
  );
}

/**
 * v0.3 StatCard — tinted icon square, label, large tabular value, delta chip.
 * The dashboard's KPI-row atom.
 */
export function StatCard({
  label,
  value,
  icon: IconComp,
  tone = "brand",
  delta,
  deltaUp = true,
  foot,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon: Icon;
  tone?: keyof typeof iconTones;
  delta?: React.ReactNode;
  deltaUp?: boolean;
  foot?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-5 shadow-card transition-transform duration-200 hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">
            {value}
          </div>
        </div>
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md",
            iconTones[tone],
          )}
        >
          <IconComp className="size-5" />
        </div>
      </div>
      {(delta || foot) && (
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          {delta && <DeltaBadge up={deltaUp}>{delta}</DeltaBadge>}
          {foot}
        </div>
      )}
    </div>
  );
}
