"use client";

import { IconMoon, IconSearch, IconSun } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import * as React from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { trackEvent } from "@/lib/analytics";

export type PaletteLink = {
  group: string;
  label: string;
  href: string;
};

export function CommandPalette({
  links,
  variant = "bar",
}: {
  links: PaletteLink[];
  variant?: "bar" | "sidebar";
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  const toggleOpen = React.useCallback((next: boolean) => {
    if (next) {
      trackEvent("ui.dialog_opened", { name: "command_palette" });
    }
    setOpen(next);
  }, []);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleOpen(!open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, toggleOpen]);

  const groups = links.reduce<Map<string, PaletteLink[]>>((acc, link) => {
    const list = acc.get(link.group) ?? [];
    list.push(link);
    acc.set(link.group, list);
    return acc;
  }, new Map());

  if (variant === "sidebar") {
    return (
      <>
        <button
          type="button"
          onClick={() => toggleOpen(true)}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-xs text-muted-foreground shadow-card transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconSearch className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        {CommandDialogContent()}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => toggleOpen(true)}
        className="hidden h-8 w-56 items-center gap-2 rounded-md border border-input bg-muted px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:flex lg:w-72"
      >
        <IconSearch className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button
        type="button"
        onClick={() => toggleOpen(true)}
        aria-label="Search"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
      >
        <IconSearch className="size-4" />
      </button>
      {CommandDialogContent()}
    </>
  );

  function CommandDialogContent() {
    return (
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search or jump to…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {[...groups.entries()].map(([group, groupLinks]) => (
            <CommandGroup key={group} heading={group}>
              {groupLinks.map((link) => (
                <CommandItem
                  key={link.href}
                  onSelect={() => {
                    trackEvent("ui.shortcut_press", {
                      action: "navigate",
                      href: link.href,
                      label: link.label,
                    });
                    setOpen(false);
                    router.push(link.href);
                  }}
                >
                  {link.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandGroup heading="Theme">
            <CommandItem
              onSelect={() => {
                trackEvent("ui.theme_toggle", {
                  to: "light",
                  source: "command_palette",
                });
                setOpen(false);
                setTheme("light");
              }}
            >
              <IconSun />
              Light theme
            </CommandItem>
            <CommandItem
              onSelect={() => {
                trackEvent("ui.theme_toggle", {
                  to: "dark",
                  source: "command_palette",
                });
                setOpen(false);
                setTheme("dark");
              }}
            >
              <IconMoon />
              Dark theme
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    );
  }
}
