import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Expressive violet-gradient feature tile (AI / primary moment). Opt-in tone —
 * flagship dashboard and marketing surfaces only.
 */
export function FeatureCard({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-gradient-brand p-5 text-white shadow-card",
        className,
      )}
    >
      <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/15 blur-2xl" />
      {eyebrow && (
        <div className="relative text-[11px] font-bold uppercase tracking-[0.09em] text-white">
          {eyebrow}
        </div>
      )}
      <h3 className="relative mt-1.5 font-heading text-[15px] font-semibold">
        {title}
      </h3>
      {description && (
        <p className="relative mt-1.5 max-w-[34ch] text-xs text-white/90">
          {description}
        </p>
      )}
      {action && <div className="relative mt-4">{action}</div>}
    </div>
  );
}

/** Progress/goal row — icon-less label + violet bar + detail. */
export function GoalRow({
  label,
  detail,
  pct,
}: {
  label: string;
  detail: string;
  pct: number;
}) {
  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>{label}</span>
        <span className="text-primary tabular-nums">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
