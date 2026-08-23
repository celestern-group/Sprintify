import { IconAlertCircle, IconAlertTriangle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CalloutTone = "warning" | "danger";

const TONE_CLASSES: Record<CalloutTone, { surface: string; icon: string }> = {
  warning: { surface: "bg-warning-tint", icon: "text-warning" },
  danger: { surface: "bg-danger-tint", icon: "text-destructive" },
};

const TONE_ICONS: Record<CalloutTone, typeof IconAlertTriangle> = {
  warning: IconAlertTriangle,
  danger: IconAlertCircle,
};

export function Callout({
  tone = "warning",
  icon,
  children,
  className,
}: {
  tone?: CalloutTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const DefaultIcon = TONE_ICONS[tone];
  const { surface, icon: iconColor } = TONE_CLASSES[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-border p-3 text-sm text-foreground",
        surface,
        className,
      )}
    >
      {icon ?? (
        <DefaultIcon className={cn("mt-0.5 size-4 shrink-0", iconColor)} />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
