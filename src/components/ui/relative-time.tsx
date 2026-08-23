"use client";

import { formatDistanceToNow } from "date-fns";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type RelativeTimeProps = {
  /** Replaces the relative label (e.g. "· edited") while keeping the tooltip. */
  children?: ReactNode;
  className?: string;
  date: Date | string;
  /** Prefixes the absolute-time tooltip, e.g. "Edited". */
  titlePrefix?: string;
  /** Re-render cadence in ms; `0` disables ticking. Defaults to 60s. */
  tickMs?: number;
};

/**
 * Relative timestamp ("about 8 hours ago") with an absolute-time tooltip.
 *
 * The tooltip is deliberately client-only: `toLocaleString()` resolves to the
 * server's locale during SSR (en-US) and to the browser's on hydration (en-GB,
 * …), which is a guaranteed hydration mismatch. The relative label itself can
 * drift across the render boundary from plain clock skew, so the element also
 * carries `suppressHydrationWarning` and recomputes on mount.
 */
export function RelativeTime({
  children,
  className,
  date,
  titlePrefix,
  tickMs = 60_000,
}: RelativeTimeProps) {
  const value = typeof date === "string" ? new Date(date) : date;
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    setMounted(true);
    if (tickMs <= 0) return;
    const id = setInterval(() => setTick((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  const absolute = mounted ? value.toLocaleString() : undefined;
  const title = absolute
    ? titlePrefix
      ? `${titlePrefix} ${absolute}`
      : absolute
    : undefined;

  return (
    <time
      className={cn("tabular-nums", className)}
      dateTime={value.toISOString()}
      suppressHydrationWarning
      title={title}
    >
      {children ?? formatDistanceToNow(value, { addSuffix: true })}
    </time>
  );
}
