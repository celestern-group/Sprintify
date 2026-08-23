"use client";

import { IconPlus, IconSelector } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  scopeCardClassName,
  scopeContextClassName,
  scopeSubjectClassName,
} from "@/components/app/scope-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import type { UserOrganization } from "@/lib/session";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function orgRoleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

/**
 * The org picker itself, as a centered modal with no trigger of its own.
 * Switching org changes the whole workspace (active org on the session, then a
 * navigation), so it reads as a deliberate context change rather than a menu —
 * and being trigger-less lets the sidebar's combined scope control open it from
 * inside its own popover.
 */
export function OrgSwitchDialog({
  organizations,
  activeSlug,
  basePath = "/app",
  canCreateOrg = true,
  open,
  onOpenChange,
}: {
  organizations: UserOrganization[];
  activeSlug?: string;
  /** Route prefix to land on after switching, e.g. "/app" or "/manage-org". */
  basePath?: string;
  /** Hides "New organization" when creation is unavailable. */
  canCreateOrg?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  async function switchTo(org: UserOrganization) {
    if (org.slug === activeSlug) {
      onOpenChange(false);
      return;
    }
    setSwitchingId(org.id);
    await authClient.organization.setActive({ organizationId: org.id });
    setSwitchingId(null);
    onOpenChange(false);
    router.push(`${basePath}/${org.slug}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0" showCloseButton>
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>Switch organization</DialogTitle>
          <DialogDescription>
            Choose which organization to work in.
          </DialogDescription>
        </DialogHeader>
        <Command className="bg-transparent p-2 pt-0">
          <CommandInput placeholder="Find an organization…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No organizations match that.</CommandEmpty>
            {organizations.map((org) => (
              <CommandItem
                key={org.id}
                value={`${org.name} ${org.slug}`}
                data-checked={org.slug === activeSlug ? "true" : undefined}
                disabled={switchingId !== null}
                onSelect={() => switchTo(org)}
                className="gap-2.5 py-2"
              >
                <Avatar className="size-7 rounded-md">
                  <AvatarImage src={org.logo ?? undefined} />
                  <AvatarFallback className="rounded-md text-[10px] font-bold">
                    {org.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-semibold">{org.name}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {orgRoleLabel(org.role)}
                  </span>
                </span>
                {switchingId === org.id ? (
                  <Spinner className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        {canCreateOrg ? (
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                router.push("/app/new");
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
            >
              <IconPlus className="size-4 shrink-0" />
              New organization
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Org-only scope control — the administration shells have no project below the
 * org, so the lockup's top line names the scope instead of the parent.
 */
export function OrgSwitcher({
  organizations,
  activeSlug,
  basePath = "/app",
  canCreateOrg = true,
}: {
  organizations: UserOrganization[];
  activeSlug?: string;
  basePath?: string;
  canCreateOrg?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = organizations.find((org) => org.slug === activeSlug);
  // One org and nowhere to go: the card is an identity label, not a control —
  // no chevron, no dialog, nothing to tab to.
  const interactive = organizations.length > 1 || canCreateOrg;

  const lockup = (
    <>
      <Avatar className="size-7 shrink-0 rounded-md">
        <AvatarImage src={active?.logo ?? undefined} />
        <AvatarFallback className="rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
          {(active?.name ?? "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className={scopeContextClassName}>
          {active ? `Organization · ${orgRoleLabel(active.role)}` : "Sprintify"}
        </span>
        <span className={scopeSubjectClassName}>
          {active?.name ?? "Select organization"}
        </span>
      </span>
      {interactive ? (
        <IconSelector className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );

  if (!interactive) {
    return <div className={scopeCardClassName}>{lockup}</div>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          active ? `Organization: ${active.name}` : "Select an organization"
        }
        className={scopeCardClassName}
      >
        {lockup}
      </button>
      <OrgSwitchDialog
        organizations={organizations}
        activeSlug={activeSlug}
        basePath={basePath}
        canCreateOrg={canCreateOrg}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
