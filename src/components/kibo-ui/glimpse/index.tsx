"use client";

import type { ComponentProps } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

/**
 * Kibo UI "glimpse" (https://www.kibo-ui.com/components/glimpse) — a hover
 * preview card. Vendored per the registry, with two changes: the import alias
 * is ours, and the upstream `server.tsx` (an OG-tag scraper for URL previews)
 * is not vendored — nothing here previews a foreign URL, and shipping a
 * fetch-any-url helper would be an SSRF surface for no feature.
 *
 * This is the shell only. The person card built on it is `UserGlimpse`
 * (`src/components/app/user-glimpse.tsx`).
 */
export type GlimpseProps = ComponentProps<typeof HoverCard>;

export const Glimpse = (props: GlimpseProps) => <HoverCard {...props} />;

export type GlimpseContentProps = ComponentProps<typeof HoverCardContent>;

export const GlimpseContent = (props: GlimpseContentProps) => (
  <HoverCardContent {...props} />
);

export type GlimpseTriggerProps = ComponentProps<typeof HoverCardTrigger>;

export const GlimpseTrigger = (props: GlimpseTriggerProps) => (
  <HoverCardTrigger {...props} />
);

export type GlimpseTitleProps = ComponentProps<"p">;

export const GlimpseTitle = ({ className, ...props }: GlimpseTitleProps) => (
  <p className={cn("truncate font-semibold text-sm", className)} {...props} />
);

export type GlimpseDescriptionProps = ComponentProps<"p">;

export const GlimpseDescription = ({
  className,
  ...props
}: GlimpseDescriptionProps) => (
  <p
    className={cn("line-clamp-2 text-muted-foreground text-sm", className)}
    {...props}
  />
);
