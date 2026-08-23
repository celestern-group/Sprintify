/**
 * Shared skin for the sidebar's scope control — the stacked lockup at the top
 * of the sidebar that says which organization and project you are in. It is
 * deliberately the same raised-card object as the user card pinned to the
 * sidebar's foot, so the two ends of the chrome read as a matched pair.
 */
export const scopeCardClassName =
  "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card p-2 text-left shadow-card outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent";

/** Top line: the wider context, in small caps. */
export const scopeContextClassName =
  "truncate text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground";

/** Bottom line: the thing the control actually selects. */
export const scopeSubjectClassName = "truncate text-[13px] font-semibold";
