import { IconChevronDown, IconChevronUp, IconMinus } from "@tabler/icons-react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Kibo UI's Pill, re-tokened for Sprintify DS v0.3. The API is upstream's — same
   component names, same props — so a registry update stays a readable diff.
   Four things are deliberately NOT upstream's, because upstream ships raw
   Tailwind palette values and a weight that fights the chip ramp:

   1. Every colour is a DS token (`--success`, `--warning`, `--destructive`,
      `--chart-2`, `--brand`, `--critical`). Upstream hard-codes emerald/rose/
      amber/sky-500, which ignore the theme, ignore a white-label `--primary`
      swap, and were never contrast-checked against the chip surface.
   2. The label stays 11px/600 (Badge's ramp). Upstream's `font-normal` would
      give the app a second chip weight.
   3. The pulse layer is REMOVED under `prefers-reduced-motion`, not merely
      paused — `animate-none` strands a permanent 75%-opacity halo, which reads
      as a different state rather than a calm one.
   4. `themed` is wired to the violet tint instead of being a dead prop that
      upstream destructures only to keep it off the DOM.

   Pills run 24px tall (Badge's chip is 22px) because an avatar and a dismiss
   button need the extra 2px; Badge is `overflow-hidden`, so a control taller
   than the pill gets clipped rather than overflowing. */

export type PillProps = ComponentProps<typeof Badge> & {
  /**
   * Violet-tint surface — the DS "active/selected" treatment. The tint ships
   * as `--secondary` in this codebase, not as a `--tint` token; `bg-tint` and
   * `text-tint-ink` are spec names that were never wired into `globals.css`
   * and silently resolve to nothing.
   */
  themed?: boolean;
};

export const Pill = ({
  variant = "secondary",
  themed = false,
  className,
  ...props
}: PillProps) => (
  <Badge
    className={cn(
      "h-6 gap-2 rounded-full px-3",
      themed && "bg-secondary text-secondary-foreground",
      className,
    )}
    variant={variant}
    {...props}
  />
);

export type PillAvatarProps = ComponentProps<typeof AvatarImage> & {
  fallback?: string;
};

export const PillAvatar = ({
  fallback,
  className,
  ...props
}: PillAvatarProps) => (
  <Avatar className={cn("-ml-1 size-4 text-[9px]", className)}>
    <AvatarImage {...props} />
    <AvatarFallback>{fallback}</AvatarFallback>
  </Avatar>
);

export type PillButtonProps = ComponentProps<typeof Button>;

/**
 * The dismiss/action control inside a pill. Always a real `<button>`.
 *
 * It cannot be used when the pill itself sits inside another button (a
 * `PopoverTrigger`, say) — a button's content model forbids interactive
 * content. `render={<span />}` does NOT solve that: Base UI asserts on it, and
 * `nativeButton={false}` only trades the native element for `role="button"`,
 * which is the same nesting violation. Those call sites need a plain
 * click-handled span; `TagsValue` is the worked example.
 */

export const PillButton = ({ className, ...props }: PillButtonProps) => (
  <Button
    className={cn(
      "-mr-1.5 size-4 rounded-full p-0 hover:bg-muted [&_svg]:size-3",
      className,
    )}
    size="icon"
    variant="ghost"
    {...props}
  />
);

export type PillStatusProps = {
  children: ReactNode;
  className?: string;
};

/* A <span>, not upstream's <div> — Badge renders a <span>, and a div inside it
   is invalid HTML that React will hydrate-warn on. Same for PillAvatarGroup. */
export const PillStatus = ({
  children,
  className,
  ...props
}: PillStatusProps) => (
  <span
    className={cn(
      "-ml-1 flex items-center gap-1.5 border-border border-r pr-2",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

const INDICATOR_TONES = {
  brand: "bg-brand",
  success: "bg-success",
  error: "bg-destructive",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-chart-2",
  neutral: "bg-muted-foreground",
} as const;

export type PillIndicatorProps = {
  variant?: keyof typeof INDICATOR_TONES;
  pulse?: boolean;
  className?: string;
};

/**
 * A status dot, optionally pulsing for live/streaming state.
 *
 * It is `aria-hidden`, so per the DS rule that colour is never the only signal
 * it must sit beside a real text label inside the pill.
 */
export const PillIndicator = ({
  variant = "success",
  pulse = false,
  className,
}: PillIndicatorProps) => (
  <span aria-hidden className={cn("relative flex size-2 shrink-0", className)}>
    {pulse && (
      <span
        className={cn(
          "absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:hidden",
          INDICATOR_TONES[variant],
        )}
      />
    )}
    <span
      className={cn(
        "relative inline-flex size-2 rounded-full",
        INDICATOR_TONES[variant],
      )}
    />
  </span>
);

export type PillDeltaProps = {
  className?: string;
  delta: number;
};

/**
 * Direction mark for a change. The arrow carries the meaning and the label
 * carries it again for screen readers — hue alone never states the direction.
 */
export const PillDelta = ({ className, delta }: PillDeltaProps) => {
  const { Icon, tone, label } = !delta
    ? { Icon: IconMinus, tone: "text-muted-foreground", label: "no change" }
    : delta > 0
      ? { Icon: IconChevronUp, tone: "text-success", label: "up" }
      : { Icon: IconChevronDown, tone: "text-destructive", label: "down" };

  return (
    <span className="inline-flex items-center">
      <Icon aria-hidden className={cn("size-3 shrink-0", tone, className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
};

export type PillIconProps = {
  /** Any Tabler or Lucide icon — both take `className`. */
  icon: ComponentType<{ className?: string }>;
  className?: string;
};

export const PillIcon = ({
  icon: Icon,
  className,
  ...props
}: PillIconProps) => (
  <Icon
    className={cn("size-3 shrink-0 text-muted-foreground", className)}
    {...props}
  />
);

export type PillAvatarGroupProps = {
  children: ReactNode;
  className?: string;
};

export const PillAvatarGroup = ({
  children,
  className,
  ...props
}: PillAvatarGroupProps) => (
  <span
    className={cn(
      "-space-x-1 -ml-1 flex items-center",
      "[&>*:not(:first-of-type)]:mask-[radial-gradient(circle_9px_at_-4px_50%,transparent_99%,white_100%)]",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);
