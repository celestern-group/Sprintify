import { IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Sprintify DS v0.3 page header: optional back link, uppercase eyebrow label,
 * a 30/800 display title, muted subtitle, and a toolbar slot on the right.
 *
 * `icon` is an optional identity tile shown beside the title block — for pages
 * that are ABOUT one coloured thing (a work item's type, say) rather than a
 * section of the app.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel = "Back",
  icon,
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  /** Rendered as-is; size it to ~40px so it aligns with the title block. */
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {/* The back link is a separate zone from the identity block, so it gets
            its own gap rather than the column's 4px: `mb-3` plus the `gap-1`
            below it reads as 16px. At the column gap alone the eyebrow crowds
            the link and the two scan as one stacked label. */}
        {backHref ? (
          <Link
            href={backHref}
            className="mb-3 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            {backLabel}
          </Link>
        ) : null}
        <div className="flex min-w-0 items-center gap-3">
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow ? (
              <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand">
                {eyebrow}
              </span>
            ) : null}
            <h1 className="font-heading text-3xl font-extrabold tracking-tight">
              {title}
            </h1>
          </div>
        </div>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
