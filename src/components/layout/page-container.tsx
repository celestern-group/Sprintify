import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The single horizontal frame for every in-app page.
 *
 * One width per screen, centered — settings, forms, dashboards and data
 * tables inside a screen share it so the left and right gutters never shift
 * between routes. Per-page caps (the old 3xl/4xl/6xl mix) are what made the
 * content jump sideways on navigation; don't reintroduce them.
 *
 * Two widths exist, and each is used by a whole screen, never a single route:
 * - `"column"` (default) — `max-w-5xl`, for manage-org / admin / profile.
 * - `"full"` — the app shell (`/app/[orgSlug]/**`), whose timelines, gantts
 *   and capacity grids need the whole canvas.
 */
export function PageContainer({
  width = "column",
  fill = false,
  className,
  children,
}: {
  width?: "column" | "full";
  /** Stretch to the scroll container's height so a child marked `flex-1
      min-h-0` (a board, a gantt) can fill the viewport and scroll inside
      itself. Short pages still sit at the top; tall ones still page-scroll. */
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    // `min-h-0` on BOTH levels, not just the inner one: a flex item keeps
    // `min-height: auto`, so without it this wrapper floors at its content's
    // min-content height and a `flex-1` child (a board, a gantt) grows the
    // page instead of capping at the shell and scrolling inside itself.
    <div
      className={cn(
        "w-full p-4 sm:p-6",
        fill && "flex min-h-0 flex-1 flex-col",
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-6",
          width === "column" && "max-w-5xl",
          fill && "min-h-0 flex-1",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
