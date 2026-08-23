"use client";

import {
  IconArrowsLeftRight,
  IconCheck,
  IconSelector,
  IconSettings,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  scopeCardClassName,
  scopeContextClassName,
  scopeSubjectClassName,
} from "@/components/app/scope-card";
import {
  OrgSwitchDialog,
  orgRoleLabel,
} from "@/components/dashboard/org-switcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { selectActiveProject } from "@/lib/actions/active-project";
import type { ProjectPermissionKey } from "@/lib/project-permissions";
import type { UserOrganization } from "@/lib/session";
import { cn } from "@/lib/utils";

export type SwitcherProject = {
  id: string;
  key: string;
  name: string;
  /** The caller's effective permissions — drives the sidebar section list. */
  permissions: ProjectPermissionKey[];
};

const RECENTS_LIMIT = 6;

function recentsStorageKey(orgSlug: string) {
  return `sprintify:recent-projects:${orgSlug}`;
}

function readRecents(orgSlug: string): string[] {
  try {
    const raw = window.localStorage.getItem(recentsStorageKey(orgSlug));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * The sidebar's scope control: one stacked lockup reading "which org · your
 * role" above "which project". Both scopes live in a single object because you
 * are always in exactly one of each, and they nest — but they open different
 * things. The card opens the project picker (many times an hour, so it filters
 * and orders by recency); "Switch organization" inside it opens the org modal,
 * because changing org replaces the whole workspace.
 */
export function ScopeSwitcher({
  organizations,
  activeSlug,
  projects,
  activeKey,
  routeSuffix = "",
  pinOnly = false,
  manageHref,
  canCreateOrg = true,
  onNavigate,
}: {
  organizations: UserOrganization[];
  activeSlug: string;
  projects: SwitcherProject[];
  activeKey?: string;
  /** Path below /app/[orgSlug]/[projectKey], carried across the switch. */
  routeSuffix?: string;
  /**
   * True on the org-level sections (/availability): there is no project in
   * the URL to rewrite, so switching moves the session pointer and re-renders
   * the page in place instead of navigating away from it.
   */
  pinOnly?: boolean;
  /** Shown as the footer action when the caller can administer projects. */
  manageHref?: string | null;
  canCreateOrg?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  // Reads after mount only — localStorage isn't available during SSR, and
  // seeding state from it directly would desync hydration.
  useEffect(() => {
    setRecents(readRecents(activeSlug));
  }, [activeSlug]);

  // Records visits however they happened: this picker, ⌘K, or a pasted link.
  useEffect(() => {
    if (!activeKey) return;
    setRecents((current) => {
      const next = [activeKey, ...current.filter((k) => k !== activeKey)].slice(
        0,
        RECENTS_LIMIT,
      );
      window.localStorage.setItem(
        recentsStorageKey(activeSlug),
        JSON.stringify(next),
      );
      return next;
    });
  }, [activeKey, activeSlug]);

  const ordered = useMemo(() => {
    const rank = new Map(recents.map((key, index) => [key, index]));
    return [...projects].sort((a, b) => {
      const aRank = rank.get(a.key) ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(b.key) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });
  }, [projects, recents]);

  const activeOrg = organizations.find((org) => org.slug === activeSlug);
  const activeProject = projects.find(
    (candidate) => candidate.key === activeKey,
  );
  const canSwitchOrg = organizations.length > 1 || canCreateOrg;

  function select(target: SwitcherProject) {
    setOpen(false);
    onNavigate?.();

    if (pinOnly) {
      // Optimistic: the label flips on the next render either way, and a failed
      // pin (revoked access) simply leaves the page on the project it had.
      startTransition(async () => {
        await selectActiveProject({
          orgSlug: activeSlug,
          projectKey: target.key,
        });
        router.refresh();
      });
      return;
    }

    // Staying on the same sub-page across a switch is the whole point of the
    // control; the target route falls back to the project home if that page
    // doesn't exist there.
    router.push(`/app/${activeSlug}/${target.key}${routeSuffix}`);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={
            activeProject
              ? `Project: ${activeProject.name}`
              : "Select a project"
          }
          className={scopeCardClassName}
        >
          <Avatar className="size-7 shrink-0 rounded-md">
            <AvatarImage src={activeOrg?.logo ?? undefined} />
            <AvatarFallback className="rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
              {(activeOrg?.name ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className={scopeContextClassName}>
              {activeOrg
                ? `${activeOrg.name} · ${orgRoleLabel(activeOrg.role)}`
                : "Organization"}
            </span>
            <span className={scopeSubjectClassName}>
              {activeProject?.name ?? "Select project"}
            </span>
          </span>
          <IconSelector className="size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 gap-0 p-0">
          <Command>
            <CommandInput placeholder="Find a project…" />
            <CommandList className="max-h-72">
              <CommandEmpty>
                {projects.length === 0
                  ? "No projects yet."
                  : "No projects match that."}
              </CommandEmpty>
              {ordered.map((candidate) => (
                <CommandItem
                  key={candidate.id}
                  value={`${candidate.key} ${candidate.name}`}
                  onSelect={() => select(candidate)}
                >
                  <span className="truncate">{candidate.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    <span className="rounded-sm bg-chip px-1.5 py-0.5 text-[11px] font-bold text-foreground uppercase tabular-nums">
                      {candidate.key}
                    </span>
                    <IconCheck
                      className={cn(
                        "size-4",
                        candidate.key === activeKey
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
          {manageHref || canSwitchOrg ? (
            <div className="flex flex-col border-t border-border p-1">
              {manageHref ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                    router.push(manageHref);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                >
                  <IconSettings className="size-4 shrink-0" />
                  Manage projects
                </button>
              ) : null}
              {canSwitchOrg ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setOrgDialogOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                >
                  <IconArrowsLeftRight className="size-4 shrink-0" />
                  Switch organization
                </button>
              ) : null}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <OrgSwitchDialog
        organizations={organizations}
        activeSlug={activeSlug}
        canCreateOrg={canCreateOrg}
        open={orgDialogOpen}
        onOpenChange={setOrgDialogOpen}
      />
    </>
  );
}
