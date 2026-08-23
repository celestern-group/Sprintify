import { IconAlertTriangle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Says out loud that a form on a project page writes data the whole
 * organization shares.
 *
 * Availability and holiday calendars are org-owned rows (one capacity profile
 * per member, one calendar serving many projects) that are edited from inside a
 * project's workspace. The URL implies project scope and the write is wider
 * than that, so the difference is stated rather than inferred — colour alone
 * never carries it, hence the icon and the text.
 */
export function ScopeNotice({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-border bg-warning-tint px-3.5 py-3 text-sm text-foreground",
        className,
      )}
    >
      <IconAlertTriangle
        className="mt-px size-4 shrink-0 text-warning"
        aria-hidden
      />
      <p className="min-w-0">{children}</p>
    </div>
  );
}
