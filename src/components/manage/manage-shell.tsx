"use client";

import {
  type Icon,
  IconAlertOctagon,
  IconArrowLeft,
  IconBell,
  IconBriefcase,
  IconBuilding,
  IconCalendarTime,
  IconFolder,
  IconHistory,
  IconKey,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconMenu2,
  IconRocket,
  IconSettings,
  IconShieldLock,
  IconSparkles,
  IconUserShield,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { openAdminSetup } from "@/components/admin/setup-wizard";
import {
  CommandPalette,
  type PaletteLink,
} from "@/components/app/command-palette";
import { NotificationBell } from "@/components/app/notification-bell";
import { StopImpersonatingBanner } from "@/components/app/stop-impersonating-banner";
import { UserMenu } from "@/components/app/user-menu";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import type { BellData } from "@/lib/actions/notifications";
import type { UserOrganization } from "@/lib/session";
import { cn } from "@/lib/utils";

const SEGMENT_LABELS: Record<string, string> = {
  projects: "Projects",
  members: "Members",
  teams: "Teams",
  "work-items": "Work item types",
  roles: "Roles",
  "working-time": "Working time",
  sso: "SSO",
  settings: "Settings",
  audit: "Audit log",
  users: "Users",
  organizations: "Organizations",
  platform: "Controls",
  ai: "AI",
};

type NavItem = { title: string; url: string; icon: Icon };
type NavGroup = { label?: string; items: NavItem[] };

const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 400;
const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_WIDTH_KEY = "sprintify:manage-sidebar-width";

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/**
 * Administration chrome — one scope shared by org management (/manage-org)
 * and platform admin (/admin): both are "run the org/platform," not "use the
 * product," so they share a sidebar (org nav + Platform nav side by side)
 * rather than being split by route tree. Deliberately separate from
 * `AppShell` (the /app member workspace) — cross into it via the user menu's
 * "Back to app" link.
 */
export function ManageShell({
  organizations,
  activeSlug,
  canManageOrg = false,
  canCreateOrg = true,
  isAdmin = false,
  needsSetup = false,
  user,
  impersonatedBy,
  bell,
  children,
}: {
  organizations: UserOrganization[];
  activeSlug?: string;
  canManageOrg?: boolean;
  canCreateOrg?: boolean;
  isAdmin?: boolean;
  needsSetup?: boolean;
  user: { name: string; email: string; image?: string | null };
  impersonatedBy?: string | null;
  /** Server-fetched bell state; absent outside an org (e.g. /admin). */
  bell?: { organizationId: string; orgSlug: string; data: BellData };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const activeOrg = organizations.find((org) => org.slug === activeSlug);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const parsed = Number.parseInt(stored, 10);
      if (!Number.isNaN(parsed)) setSidebarWidth(clampSidebarWidth(parsed));
    }
  }, []);

  const startResizing = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(event.clientX));
    };
    const stopResizing = () => setIsResizing(false);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [isResizing, sidebarWidth]);

  const resetSidebarWidth = useCallback(
    () => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH),
    [],
  );

  let rootLabel = "Sprintify";
  let rootHref = "/manage-org";
  if (pathname.startsWith("/admin")) {
    rootLabel = "Admin";
    rootHref = "/admin/users";
  } else if (activeOrg) {
    rootLabel = activeOrg.name;
    rootHref = `/manage-org/${activeOrg.slug}`;
  }
  const segments = pathname.split("/").filter(Boolean);
  // Detail routes end in an opaque id (e.g. /projects/<projectId>), so fall
  // back to the parent segment to label the section.
  const sectionLabel =
    pathname === rootHref
      ? undefined
      : (SEGMENT_LABELS[segments.at(-1) ?? ""] ??
        SEGMENT_LABELS[segments.at(-2) ?? ""]);

  const navGroups: NavGroup[] = [];
  const paletteLinks: PaletteLink[] = [];

  if (activeOrg && canManageOrg) {
    const orgItems: NavItem[] = [
      {
        title: "Overview",
        url: `/manage-org/${activeOrg.slug}`,
        icon: IconLayoutDashboard,
      },
      {
        title: "Projects",
        url: `/manage-org/${activeOrg.slug}/projects`,
        icon: IconBriefcase,
      },
      {
        title: "Members",
        url: `/manage-org/${activeOrg.slug}/members`,
        icon: IconUsers,
      },
      {
        title: "Teams",
        url: `/manage-org/${activeOrg.slug}/teams`,
        icon: IconUsersGroup,
      },
      {
        title: "Work item types",
        url: `/manage-org/${activeOrg.slug}/work-items`,
        icon: IconLayoutKanban,
      },
      {
        title: "Roles",
        url: `/manage-org/${activeOrg.slug}/roles`,
        icon: IconUserShield,
      },
      {
        title: "Working time",
        url: `/manage-org/${activeOrg.slug}/working-time`,
        icon: IconCalendarTime,
      },
      {
        title: "SSO",
        url: `/manage-org/${activeOrg.slug}/sso`,
        icon: IconKey,
      },
      {
        title: "AI",
        url: `/manage-org/${activeOrg.slug}/ai`,
        icon: IconSparkles,
      },
      {
        title: "Settings",
        url: `/manage-org/${activeOrg.slug}/settings`,
        icon: IconSettings,
      },
      {
        title: "Audit log",
        url: `/manage-org/${activeOrg.slug}/audit`,
        icon: IconHistory,
      },
    ];
    navGroups.push({ label: "Organization", items: orgItems });
    paletteLinks.push(
      ...orgItems.map((item) => ({
        group: "Organization",
        label: item.title,
        href: item.url,
      })),
    );
  }

  if (isAdmin) {
    navGroups.push({
      label: "Platform",
      items: [
        {
          title: "Organizations",
          url: "/admin/organizations",
          icon: IconBuilding,
        },
        { title: "Users", url: "/admin/users", icon: IconShieldLock },
        { title: "Files", url: "/admin/files", icon: IconFolder },
        { title: "AI", url: "/admin/ai", icon: IconSparkles },
        { title: "Audit log", url: "/admin/audit", icon: IconHistory },
        { title: "Controls", url: "/admin/platform", icon: IconAlertOctagon },
      ],
    });
    paletteLinks.push({
      group: "Platform",
      label: "Admin — Organizations",
      href: "/admin/organizations",
    });
    paletteLinks.push({
      group: "Platform",
      label: "Admin — Users",
      href: "/admin/users",
    });
    paletteLinks.push({
      group: "Platform",
      label: "Admin — File storage",
      href: "/admin/files",
    });
    paletteLinks.push({
      group: "Platform",
      label: "Admin — AI configuration",
      href: "/admin/ai",
    });
    paletteLinks.push({
      group: "Platform",
      label: "Admin — Audit log",
      href: "/admin/audit",
    });
    paletteLinks.push({
      group: "Platform",
      label: "Admin — Platform controls",
      href: "/admin/platform",
    });
  }

  paletteLinks.push({
    group: "Account",
    label: "Back to app",
    href: activeOrg ? `/app/${activeOrg.slug}` : "/app",
  });

  function renderSidebar(withSearch: boolean) {
    return (
      <div className="flex h-full flex-col bg-sidebar">
        <div className="flex flex-col gap-2 p-2.5">
          {organizations.length > 0 ? (
            <OrgSwitcher
              organizations={organizations}
              activeSlug={activeSlug}
              basePath="/manage-org"
              canCreateOrg={canCreateOrg}
            />
          ) : null}
          {withSearch ? (
            <CommandPalette links={paletteLinks} variant="sidebar" />
          ) : null}
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 pb-2">
          {navGroups.map((group) => (
            <div key={group.label ?? "main"}>
              {group.label ? (
                <div className="px-3 pt-3 pb-1 text-[11px] font-bold tracking-[0.09em] text-muted-foreground uppercase">
                  {group.label}
                </div>
              ) : null}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.url;
                  return (
                    <Link
                      key={item.url}
                      href={item.url}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                        active
                          ? "bg-secondary text-secondary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <item.icon className="size-[18px] shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-2.5">
          <UserMenu
            user={user}
            variant="sidebar"
            secondaryLinks={[
              {
                href: activeOrg ? `/app/${activeOrg.slug}` : "/app",
                label: "Back to app",
                icon: IconArrowLeft,
              },
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh w-full bg-stage">
      <div className="flex h-svh w-full overflow-hidden bg-sidebar">
        <aside
          className="relative hidden shrink-0 border-r border-sidebar-border md:block"
          style={{ width: sidebarWidth }}
        >
          {renderSidebar(true)}
          <button
            type="button"
            aria-label="Resize sidebar"
            onPointerDown={startResizing}
            onDoubleClick={resetSidebarWidth}
            className={cn(
              "group absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize touch-none md:block",
              "focus-visible:outline-none",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 right-1 w-px bg-transparent transition-colors",
                "group-hover:bg-primary group-focus-visible:bg-primary",
                isResizing && "bg-primary",
              )}
            />
          </button>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-5">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 md:hidden"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
            >
              <IconMenu2 />
            </Button>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-1.5 text-sm"
            >
              <Link
                href={rootHref}
                className={
                  sectionLabel
                    ? "truncate font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    : "truncate font-semibold text-foreground"
                }
              >
                {rootLabel}
              </Link>
              {sectionLabel ? (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="truncate font-semibold">{sectionLabel}</span>
                </>
              ) : null}
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              {isAdmin && needsSetup && pathname.startsWith("/admin") ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openAdminSetup}
                  data-icon="inline-start"
                >
                  <IconRocket />
                  Setup
                </Button>
              ) : null}
              {bell ? (
                <NotificationBell
                  organizationId={bell.organizationId}
                  orgSlug={bell.orgSlug}
                  initial={bell.data}
                />
              ) : (
                <Button variant="ghost" size="icon" aria-label="Notifications">
                  <IconBell />
                </Button>
              )}
              <ThemeToggle />
            </div>
          </header>
          {/* `min-h-0` is load-bearing — see the same note in AppShell: without
              it `flex-1` keeps `min-height: auto`, the column grows past the
              shell and the document scrolls instead of this element. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {impersonatedBy ? <StopImpersonatingBanner /> : null}
            {children}
          </main>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {renderSidebar(false)}
        </SheetContent>
      </Sheet>
      <Toaster />
    </div>
  );
}
