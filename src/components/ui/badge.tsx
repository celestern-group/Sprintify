import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* Sprintify DS v0.3 status lozenge — NEUTRAL surface, ink text, colour carried by
   a small dot. Two earlier treatments are retired and should not come back:
   a hairline outline (invisible), and a solid saturated fill with white text
   (a dozen colour blocks in one board row reads like 2014 Bootstrap, however
   carefully the hexes are picked). Colour is legible at 6px when it sits next
   to full-strength ink, so the chip stays neutral and the dot does the work —
   the treatment Linear/Height/Vercel converged on.

   The dot is a `before:` pseudo-element, so a variant is one extra class and
   children never change. The LABEL stays --foreground in every variant and
   only the dot takes the hue: at 11px on the chip surface, --warning (3.9:1)
   and --chart-2 (3.8:1) miss AA text contrast in light theme, while the same
   colours clear the 3:1 non-text bar comfortably as a 6px mark. Ink text also
   just reads better — the eye gets one crisp label plus one colour cue,
   instead of a whole chip tinted to a mid-strength hue. */
const dot =
  "text-foreground before:size-2 before:shrink-0 before:rounded-full before:content-['']";
const chip = "bg-chip [a]:hover:brightness-95 dark:[a]:hover:brightness-110";

const badgeVariants = cva(
  "group/badge inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-sm border border-transparent px-2.5 text-[11px] font-semibold whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3.5!",
  {
    variants: {
      variant: {
        default: cn(chip, dot, "before:bg-brand"),
        destructive: cn(chip, dot, "before:bg-destructive"),
        success: cn(chip, dot, "before:bg-success"),
        warning: cn(chip, dot, "before:bg-warning"),
        critical: cn(chip, dot, "before:bg-critical"),
        info: cn(chip, dot, "before:bg-chart-2"),
        neutral: cn(chip, dot, "before:bg-muted-foreground"),
        // Dotless neutrals — counts, names, roles. Nothing semantic to
        // signal, so they get the surface and full ink and no mark.
        secondary: cn(chip, "text-foreground"),
        // Kept for API compatibility — no longer an outline. A hairline chip
        // is exactly what this change removes.
        outline: cn(chip, "text-foreground"),
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-brand underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
