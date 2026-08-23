"use client";

import { cn } from "@/lib/utils";

/**
 * Semicircle gauge with the percentage at its centre — the v0.3 "charts are
 * heroes" pattern, drawn as a plain SVG arc rather than through Recharts,
 * because a single-value gauge needs no scales, axes or data pipeline.
 *
 * Accessibility: exposed as an image with a text alternative, and the same
 * numbers are printed beneath it in the panel, so the arc is never the only
 * way to read the value. Over-commitment is signalled by a colour AND the
 * word "over" in the label.
 */
export function CapacityGauge({
  committed,
  capacity,
  unitLabel,
  className,
}: {
  committed: number;
  capacity: number;
  unitLabel: string;
  className?: string;
}) {
  const ratio = capacity > 0 ? committed / capacity : 0;
  const percent = Math.round(ratio * 100);
  const over = ratio > 1;
  // The arc itself stops at full; the colour and label carry the overflow.
  const sweep = Math.min(1, ratio);

  const radius = 68;
  const circumference = Math.PI * radius;
  const dash = circumference * sweep;

  const label =
    capacity <= 0
      ? "No capacity planned yet"
      : `${committed} of ${capacity} ${unitLabel} committed, ${percent} percent${
          over ? " — over capacity" : ""
        }`;

  return (
    <div className={cn("flex flex-col items-center", className)}>
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
          // Reduced motion must fully calm this, per the design system —
          // hence a class (motion-reduce-aware), never an inline style.
          className={cn(
            "transition-[stroke-dasharray] duration-400 ease-out motion-reduce:transition-none",
            over ? "stroke-destructive" : "stroke-primary",
          )}
        />
        <text
          x="80"
          y="70"
          textAnchor="middle"
          className="fill-foreground text-[26px] font-extrabold tabular-nums"
        >
          {capacity > 0 ? `${percent}%` : "—"}
        </text>
      </svg>
      <p
        className={cn(
          "text-xs font-semibold tabular-nums",
          over ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {committed} / {capacity} {unitLabel}
        {over ? " · over capacity" : ""}
      </p>
    </div>
  );
}
