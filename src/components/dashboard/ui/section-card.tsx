import type * as React from "react";
import { cn } from "@/lib/utils";

/** v0.3 titled content card with optional action (e.g. "View all"). */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-card p-5 shadow-card",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-heading text-[15px] font-semibold tracking-tight">
            {title}
          </div>
          {description && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {action}
      </div>
      <div className={cn("flex-1", bodyClassName)}>{children}</div>
    </div>
  );
}
