import "server-only";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { project, projectMember, projectRole } from "@/db/schema";
import { resolveActiveProject, setActiveProject } from "@/lib/active-project";
import { findCallerMembership } from "@/lib/project-access";
import { normalizeProjectKey } from "@/lib/project-key";
import type { ProjectPermissionKey } from "@/lib/project-permissions";
import { PROJECT_PERMISSION_KEYS } from "@/lib/project-permissions";
import { canManageOrg } from "@/lib/roles";
import { getUserOrganizations, requireAuth } from "@/lib/session";

/**
 * One resolve for every page under /app/[orgSlug]/[projectKey].
 *
 * Pages can't rely on a layout to authorize them — a layout does not re-run on
 * every client-side navigation, and Next makes no guarantee that it wraps a
 * given render — so each page calls this itself. Server actions still re-check
 * independently via requireProjectPermission; this is the read-path gate, not
 * a substitute for the write-path one.
 *
 * The permission set returned is EFFECTIVE: org owners/admins get the full
 * catalog, matching the org-bypass half of requireProjectPermission, so the UI
 * and the actions agree on what the caller can do.
 */

export type WorkspaceProject = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  capacityUnit: "hours" | "points";
  sprintLengthDays: number;
  defaultHoursPerDay: number;
  workingWeekdays: number[];
  timezone: string;
  holidayCalendarId: string | null;
};

export type ProjectWorkspace = {
  organization: { id: string; slug: string; name: string; role: string };
  /** The caller's `member` row id in this organization. */
  memberId: string;
  project: WorkspaceProject;
  permissions: ProjectPermissionKey[];
  can: (permission: ProjectPermissionKey) => boolean;
  /** True when the caller reached the project through org owner/admin rights
   * rather than a project role — used to explain "you see this as an admin". */
  viaOrgAdmin: boolean;
  basePath: string;
};

const PROJECT_COLUMNS = {
  id: project.id,
  key: project.key,
  name: project.name,
  description: project.description,
  capacityUnit: project.capacityUnit,
  sprintLengthDays: project.sprintLengthDays,
  defaultHoursPerDay: project.defaultHoursPerDay,
  workingWeekdays: project.workingWeekdays,
  timezone: project.timezone,
  holidayCalendarId: project.holidayCalendarId,
};

export async function requireProjectWorkspace(
  orgSlug: string,
  projectKey: string,
  /** Pages that need more than project:view name it here. */
  required: ProjectPermissionKey = "project:view",
): Promise<ProjectWorkspace> {
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);
  const org = organizations.find((candidate) => candidate.slug === orgSlug);
  if (!org) redirect("/app");

  const membership = await findCallerMembership(session.user.id, org.id);
  if (!membership) redirect("/app");

  const normalized = normalizeProjectKey(projectKey);
  if (!normalized) notFound();

  const [row] = await db
    .select(PROJECT_COLUMNS)
    .from(project)
    .where(and(eq(project.organizationId, org.id), eq(project.key, normalized)))
    .limit(1);
  // 404 rather than 403, and the same 404 for "not yours" below: the URL must
  // not reveal which project keys an organization has.
  if (!row) notFound();

  const viaOrgAdmin = canManageOrg(membership.role);
  let permissions: ProjectPermissionKey[];

  if (viaOrgAdmin) {
    permissions = [...PROJECT_PERMISSION_KEYS];
  } else {
    const [assignment] = await db
      .select({ permissions: projectRole.permissions })
      .from(projectMember)
      .innerJoin(projectRole, eq(projectMember.roleId, projectRole.id))
      .where(
        and(
          eq(projectMember.projectId, row.id),
          eq(projectMember.memberId, membership.id),
        ),
      )
      .limit(1);
    if (!assignment) notFound();
    permissions = assignment.permissions;
  }

  // Opening a project is what pins it: the org-level pages that render inside
  // project chrome (/availability) and the /app/[orgSlug] redirect all read
  // this pointer back. Written once the caller is known to
  // hold the project — but before `required` is enforced, since a section they
  // can't open doesn't unpin the project they can.
  await setActiveProject({
    sessionId: session.session.id,
    currentActiveProjectId: session.session.activeProjectId,
    projectId: row.id,
  });

  if (!permissions.includes(required)) notFound();

  return {
    organization: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      role: membership.role,
    },
    memberId: membership.id,
    project: row,
    permissions,
    can: (permission) => permissions.includes(permission),
    viaOrgAdmin,
    basePath: `/app/${org.slug}/${row.key}`,
  };
}

/**
 * The same resolve for the org-level pages that still render as a project —
 * currently just /app/[orgSlug]/availability. Its data (capacity profiles,
 * leave) is organization-scoped, but the page is scoped to the session's
 * active project for its roster and its gate, so the URL carries no project
 * segment and this reads the pointer instead.
 *
 * Redirects to the org home when the caller can open no project at all — that
 * page is where "pick a project" lives.
 */
export async function requireActiveProjectWorkspace(
  orgSlug: string,
  required: ProjectPermissionKey = "project:view",
): Promise<ProjectWorkspace> {
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);
  const org = organizations.find((candidate) => candidate.slug === orgSlug);
  if (!org) redirect("/app");

  const active = await resolveActiveProject({
    organizationId: org.id,
    userId: session.user.id,
    activeProjectId: session.session.activeProjectId,
  });
  if (!active) redirect(`/app/${org.slug}`);

  // Deliberately re-entered rather than inlined: the caller must pass the same
  // permission gate they would on the project's own route, and this keeps one
  // implementation of that gate.
  return requireProjectWorkspace(orgSlug, active.key, required);
}
