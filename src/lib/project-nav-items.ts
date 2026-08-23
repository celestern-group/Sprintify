import type { ProjectPermissionKey } from "@/lib/project-permissions";

/**
 * The sections of a project's workspace, derived from the caller's effective
 * permission set. A section is never listed for a page that would 404 on
 * arrival — the page re-checks the same permission itself, so this is
 * presentation, not a gate.
 *
 * Client-safe on purpose: the sidebar renders this for whichever project the
 * URL is pointing at, so it takes a plain permission array rather than a
 * ProjectWorkspace (which is server-only).
 */

export type ProjectNavItemId =
  | "overview"
  | "backlog"
  | "board"
  | "ideas"
  | "workflow"
  | "sprints"
  | "availability"
  | "cadence";

export type ProjectNavItem = {
  id: ProjectNavItemId;
  href: string;
  label: string;
};

export function projectNavItems({
  basePath,
  orgBasePath,
  permissions,
}: {
  /** /app/[orgSlug]/[projectKey] — the project-scoped sections. */
  basePath: string;
  /** /app/[orgSlug] — the org-scoped sections that still list here. */
  orgBasePath: string;
  permissions: readonly ProjectPermissionKey[];
}): ProjectNavItem[] {
  const can = (permission: ProjectPermissionKey) =>
    permissions.includes(permission);

  const items: ProjectNavItem[] = [
    { id: "overview", href: basePath, label: "Overview" },
  ];

  // The backlog owns the item views (list, board, table, timeline) behind a
  // search param; the board additionally gets a dedicated page because it is
  // the daily surface people jump straight to.
  if (can("backlog:view")) {
    items.push({
      id: "backlog",
      href: `${basePath}/backlog`,
      label: "Backlog",
    });
    items.push({ id: "ideas", href: `${basePath}/ideas`, label: "Ideas" });
    items.push({
      id: "board",
      href: `${basePath}/board`,
      label: "Board",
    });
  }
  if (can("sprint:view")) {
    items.push({
      id: "sprints",
      href: `${basePath}/sprints`,
      label: "Sprints",
    });
  }
  // Availability is the one section with no permission of its own: everyone
  // edits their own working pattern and leave (see requireAvailabilityAccess),
  // and capacity:view only decides whether the team roster is on the page too.
  // It hangs off the org, not the project — the data is org-scoped and the page
  // reads the session's active project for its roster — but it is listed here
  // because that is where people look for it.
  items.push({
    id: "availability",
    href: `${orgBasePath}/availability`,
    label: "Availability",
  });
  // The board's columns are project configuration; whoever shapes a project's
  // roles shapes its process, so this rides on role:manage.
  if (can("role:manage")) {
    items.push({
      id: "workflow",
      href: `${basePath}/workflow`,
      label: "Workflow",
    });
  }
  if (can("sprint:manage")) {
    // Working time itself lives under manage-org now (org-admin concern);
    // Cadence stays here since which calendar a project points at, and its
    // sprint length/start day, are project decisions.
    items.push({
      id: "cadence",
      href: `${basePath}/settings`,
      label: "Cadence",
    });
  }

  return items;
}
