"use client";

import {
  IconAdjustments,
  IconArrowLeft,
  IconBeach,
  IconBell,
  IconBulb,
  IconColumns,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconList,
  IconMenu2,
  IconRun,
  IconSettings,
  IconShieldLock,
  IconTable,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CommandPalette,
  type PaletteLink,
} from "@/components/app/command-palette";
import { CreateMenu } from "@/components/app/create-menu";
import { NotificationBell } from "@/components/app/notification-bell";
import {
  ScopeSwitcher,
  type SwitcherProject,
} from "@/components/app/scope-switcher";
import { StopImpersonatingBanner } from "@/components/app/stop-impersonating-banner";
import { UserMenu } from "@/components/app/user-menu";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { useReturnToHref } from "@/hooks/use-return-to";
import type { BellData } from "@/lib/actions/notifications";
import {
  type ProjectNavItemId,
  projectNavItems,
} from "@/lib/project-nav-items";
import { withReturnTo } from "@/lib/return-to";
import type { UserOrganization } from "@/lib/session";
import { cn } from "@/lib/utils";

const SEGMENT_LABELS: Record<string, string> = {
  profile: "Profile",
  new: "New organization",
  availability: "Availability",
  settings: "Cadence",
  sprints: "Sprints",
  backlog: "Backlog",
  board: "Board",
  ideas: "Ideas",
  workflow: "Workflow",
};

/**
 * Segments directly under /app/[orgSlug] that are pages, not project keys.
 * Next already routes them (a static segment beats [projectKey]); this is the
 * client half — without it the shell would read "availability" as the project
 * you are in and drop the sidebar.
 */
const ORG_LEVEL_SEGMENTS = new Set(["availability"]);

const PROJECT_SECTION_ICONS: Record<ProjectNavItemId, typeof IconSettings> = {
  overview: IconTable,
  backlog: IconList,
  board: IconLayoutKanban,
  ideas: IconBulb,
  workflow: IconColumns,
  sprints: IconRun,
  availability: IconBeach,
  cadence: IconAdjustments,
};

/** One sidebar row. v0.3 selection is a filled tint block, never an edge bar. */
function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof IconSettings;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4.5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 400;
const SIDEBAR_DEFAULT_WIDTH = 256; // matches the previous w-64
const SIDEBAR_WIDTH_KEY = "sprintify:sidebar-width";

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/**
 * Sprintify DS v0.3 "Aurora" app chrome: the whole app is one rounded frame that
 * floats on the `--stage` canvas — a CSS-grid sidebar (org switcher, ⌘K search,
 * nav and user card pinned to the bottom) beside a content column with its own
 * topbar. The sidebar collapses to a Sheet drawer on mobile. Scope: the member
 * workspace (/app, /profile) only — org/platform administration is a separate
 * scope with its own `ManageShell` (/manage-org + /admin); jump between the two
 * via the user menu's secondary links, not a shared nav tree.
 */
export function AppShell({
  organizations,
  activeSlug,
  projects = [],
  activeProjectKey: sessionProjectKey,
  canManageOrg = false,
  canCreateOrg = true,
  isAdmin = false,
  user,
  impersonatedBy,
  bell,
  children,
}: {
  organizations: UserOrganization[];
  activeSlug?: string;
  /** Projects in the active org the caller may open. */
  projects?: SwitcherProject[];
  /**
   * The session's active project (src/lib/active-project.ts). Used when the URL
   * carries no project segment — org-level pages that still render in project
   * chrome, e.g. /availability.
   */
  activeProjectKey?: string;
  canManageOrg?: boolean;
  canCreateOrg?: boolean;
  isAdmin?: boolean;
  user: { name: string; email: string; image?: string | null };
  impersonatedBy?: string | null;
  /** Server-fetched bell state; absent outside an org (e.g. /profile). */
  bell?: { organizationId: string; orgSlug: string; data: BellData };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const returnTo = useReturnToHref();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const activeOrg = organizations.find((org) => org.slug === activeSlug);

  // Restore the persisted width once mounted (avoids SSR hydration mismatch).
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

  // Persist the width whenever a drag settles.
  useEffect(() => {
    if (isResizing) return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [isResizing, sidebarWidth]);

  const resetSidebarWidth = useCallback(
    () => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH),
    [],
  );

  // /app/[orgSlug]/[projectKey]/... — the project segment drives the switcher
  // and the breadcrumb, so it is read off the URL rather than passed down
  // through every project route's layout.
  const segments = pathname.split("/").filter(Boolean);
  // The account pages (/profile) borrow this shell but sit outside /app, so
  // they get an explicit way back instead of the org's nav tree.
  const inAccountScope = segments[0] !== "app";
  const backToAppHref = activeOrg ? `/app/${activeOrg.slug}` : "/app";
  const inActiveOrg =
    !!activeOrg && segments[0] === "app" && segments[1] === activeOrg.slug;
  const urlProjectKey =
    inActiveOrg && segments[2] && !ORG_LEVEL_SEGMENTS.has(segments[2])
      ? segments[2]
      : undefined;
  // Org-level sections (/availability) still render as a project, and the one
  // they render as is the session's active project — the same pointer their
  // pages resolve on the server, so chrome and content can never disagree
  // about which project you are looking at.
  const activeProjectKey =
    urlProjectKey ?? (inActiveOrg ? sessionProjectKey : undefined);
  const activeProject = projects.find(
    (candidate) => candidate.key === activeProjectKey,
  );
  const projectBasePath = activeProject
    ? `/app/${activeOrg?.slug}/${activeProject.key}`
    : "";
  // What sits below the project in the URL, carried across a project switch —
  // empty on an org-level section, which switches by pointer instead (the
  // switcher's `pinOnly` path) so the page you are on survives the switch.
  const projectRouteSuffix = urlProjectKey
    ? pathname.slice(projectBasePath.length)
    : "";
  // The project's sections replace the on-page tab strip, so the sidebar is
  // the only project navigation — built from the permissions the layout
  // resolved, which are the same ones each page re-checks on arrival.
  const projectSections = activeProject
    ? projectNavItems({
        basePath: projectBasePath,
        orgBasePath: `/app/${activeOrg?.slug}`,
        permissions: activeProject.permissions,
      })
    : [];

  // The root crumb is always the way back into the org — on /profile it used
  // to be "Profile" pointing at /profile, which made the breadcrumb a dead end
  // (the account pages sit in the org chrome but under no org route).
  let rootLabel = "Sprintify";
  let rootHref = "/app";
  if (activeOrg) {
    rootLabel = activeOrg.name;
    rootHref = `/app/${activeOrg.slug}`;
  } else if (pathname.startsWith("/profile")) {
    rootLabel = "Profile";
    rootHref = "/profile";
  }
  const lastSegment = segments.at(-1) ?? "";
  const sectionLabel =
    pathname === rootHref
      ? undefined
      : (activeProject?.name ?? SEGMENT_LABELS[lastSegment]);
  // Inside a project the trail gains a third step, so "Acme / Falcon" becomes
  // "Acme / Falcon / Availability" — the sidebar shows where you are, the
  // breadcrumb shows how you got there.
  const subsectionLabel =
    activeProject && pathname !== projectBasePath
      ? (projectSections.find(
          (item) =>
            item.href !== projectBasePath &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`)),
        )?.label ?? SEGMENT_LABELS[lastSegment])
      : undefined;

  const paletteLinks: PaletteLink[] = [];

  if (activeOrg) {
    paletteLinks.push({
      group: "Organization",
      label: "Home",
      href: `/app/${activeOrg.slug}`,
    });
    // Typing two letters into ⌘K is the fastest path between projects, so
    // every project the caller can open is jumpable from there too.
    for (const candidate of projects) {
      paletteLinks.push({
        group: "Projects",
        label: `${candidate.name} (${candidate.key})`,
        href: `/app/${activeOrg.slug}/${candidate.key}`,
      });
    }
    // Sections of the project you're already in, so ⌘K reaches every page the
    // sidebar shows without leaving the keyboard.
    for (const section of projectSections) {
      paletteLinks.push({
        group: activeProject ? activeProject.name : "Project",
        label: section.label,
        href: section.href,
      });
    }
  }

  const secondaryLinks: {
    href: string;
    label: string;
    icon: typeof IconSettings;
  }[] = [];
  // Mirrors ManageShell, whose user menu offers the same escape hatch.
  if (inAccountScope) {
    secondaryLinks.push({
      href: backToAppHref,
      label: "Back to app",
      icon: IconArrowLeft,
    });
    paletteLinks.push({
      group: "Account",
      label: "Back to app",
      href: backToAppHref,
    });
  }
  if (canManageOrg && activeOrg) {
    secondaryLinks.push({
      href: `/manage-org/${activeOrg.slug}`,
      label: "Manage organization",
      icon: IconSettings,
    });
    paletteLinks.push({
      group: "Organization",
      label: "Manage organization",
      href: `/manage-org/${activeOrg.slug}`,
    });
  }
  if (isAdmin) {
    secondaryLinks.push({
      href: "/admin/users",
      label: "Admin",
      icon: IconShieldLock,
    });
    paletteLinks.push({
      group: "Platform",
      label: "Admin — Users",
      href: "/admin/users",
    });
  }

  paletteLinks.push({ group: "Account", label: "Profile", href: "/profile" });

  function renderSidebar(withSearch: boolean) {
    return (
      // Sidebar column on the card surface (white in light) rather than the
      // chrome canvas — the chrome token stays grey for the outer frame.
      <div className="flex h-full flex-col bg-card">
        <div className="flex flex-col gap-2 p-2.5">
          {activeOrg ? (
            <ScopeSwitcher
              organizations={organizations}
              activeSlug={activeOrg.slug}
              projects={projects}
              activeKey={activeProject?.key}
              routeSuffix={projectRouteSuffix}
              pinOnly={!urlProjectKey && !!activeProject}
              manageHref={
                canManageOrg
                  ? `/manage-org/${activeOrg.slug}/projects`
                  : undefined
              }
              canCreateOrg={canCreateOrg}
              onNavigate={() => setMobileOpen(false)}
            />
          ) : organizations.length > 0 ? (
            <OrgSwitcher
              organizations={organizations}
              activeSlug={activeSlug}
              canCreateOrg={canCreateOrg}
            />
          ) : null}
          {withSearch ? (
            <CommandPalette links={paletteLinks} variant="sidebar" />
          ) : null}
        </div>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 pb-2">
          {inAccountScope ? (
            <div className="flex flex-col gap-0.5">
              <NavLink
                href={backToAppHref}
                label="Back to app"
                icon={IconArrowLeft}
                active={false}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          ) : activeOrg ? (
            <div className="flex flex-col gap-0.5">
              <NavLink
                href={`/app/${activeOrg.slug}`}
                label="Home"
                icon={IconLayoutDashboard}
                active={pathname === `/app/${activeOrg.slug}`}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          ) : null}
          {activeProject && projectSections.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <span className="truncate px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                {activeProject.name}
              </span>
              {projectSections.map((section) => (
                <NavLink
                  key={section.id}
                  href={section.href}
                  label={section.label}
                  icon={PROJECT_SECTION_ICONS[section.id]}
                  // Overview owns the project root, so it can't also match
                  // every page nested beneath it.
                  active={
                    section.id === "overview"
                      ? pathname === section.href
                      : pathname === section.href ||
                        pathname.startsWith(`${section.href}/`)
                  }
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>
          ) : null}
        </nav>
        <div className="border-t border-sidebar-border p-2.5">
          <UserMenu
            user={user}
            variant="sidebar"
            secondaryLinks={secondaryLinks}
          />
        </div>
      </div>
    );
  }

  return (
    // This shell must be out of normal document flow. The overview scrolls in
    // `main`; if the shell participates in the body flex layout, the browser
    // can create a second document scrollbar and expose blank space below it.
    <div className="fixed inset-0 w-full overflow-hidden bg-stage">
      <div className="flex h-full w-full overflow-hidden bg-sidebar">
        {/* desktop sidebar */}
        <aside
          className="relative hidden shrink-0 border-r border-sidebar-border md:block"
          style={{ width: sidebarWidth }}
        >
          {renderSidebar(true)}
          {/* drag handle — resize the sidebar; double-click resets to default */}
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

        {/* content column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-5">
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
                  {subsectionLabel && projectBasePath ? (
                    <Link
                      href={projectBasePath}
                      className="truncate font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {sectionLabel}
                    </Link>
                  ) : (
                    <span className="truncate font-semibold">
                      {sectionLabel}
                    </span>
                  )}
                </>
              ) : null}
              {subsectionLabel ? (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="truncate font-semibold">
                    {subsectionLabel}
                  </span>
                </>
              ) : null}
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
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
              <CreateMenu
                activeSlug={activeOrg?.slug}
                canManageOrg={canManageOrg}
                newItemHref={
                  activeProject?.permissions.includes("item:create")
                    ? // The shell's create button fires from wherever you are;
                      // cancelling the form should put you back there.
                      withReturnTo(`${projectBasePath}/backlog/new`, returnTo)
                    : undefined
                }
              />
              <ThemeToggle />
            </div>
          </header>
          {/* `min-h-0` is load-bearing: a `flex-1` item keeps `min-height:
              auto`, so without it the main column grows to its content instead
              of capping at the shell height — `overflow-y-auto` then never
              engages and the document itself scrolls, taking the sidebar and
              topbar off-screen. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {impersonatedBy ? <StopImpersonatingBanner /> : null}
            {children}
          </main>
        </div>
      </div>

      {/* mobile sidebar drawer */}
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
