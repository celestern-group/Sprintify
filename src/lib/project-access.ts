// Shared authorization helpers for project-scoped server actions.
//
// This is a plain module, not a "use server" file: those may only export async
// functions, so anything shared and synchronous has to live outside them.

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, project, projectMember, projectRole, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { mcpActor } from "@/lib/mcp/context";
import {
  deriveProjectKey,
  normalizeProjectKey,
  PROJECT_KEY_FORMAT_MESSAGE,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_KEY_PATTERN,
} from "@/lib/project-key";
import type { ProjectPermissionKey } from "@/lib/project-permissions";
import {
  PROJECT_PERMISSION_KEYS,
  projectRoleCan,
  sanitizeProjectPermissions,
} from "@/lib/project-permissions";
import { canManageOrg } from "@/lib/roles";
import { requireAuth } from "@/lib/session";

/** The shape the project switcher and project routes need. */
export type AccessibleProject = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

/** An accessible project plus what the caller may do inside it. */
export type AccessibleProjectWithPermissions = AccessibleProject & {
  permissions: ProjectPermissionKey[];
};

/**
 * A refusal the caller is meant to READ, not a crash: "you may not do this" is
 * an outcome of the request, not a bug. It matters because Next replaces every
 * thrown message in a production build with a generic digest string — an action
 * that wants the user to see WHY it refused has to return the message instead
 * of throwing it, and this class is how a refusal is told apart from a real
 * failure that should still blow up (and reach Sentry).
 */
export class ProjectPermissionError extends Error {}

export function isUniqueViolation(error: unknown): boolean {
  const code = (candidate: unknown) =>
    (candidate as { code?: unknown } | null)?.code;
  return (
    code(error) === "23505" ||
    code((error as { cause?: unknown } | null)?.cause) === "23505"
  );
}

async function projectKeyTaken(
  organizationId: string,
  key: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(
      and(eq(project.organizationId, organizationId), eq(project.key, key)),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Resolves the key a new project should get. An explicitly requested key is
 * validated and must be free — silently renaming what someone typed would be
 * worse than an error. A derived key gets a numeric suffix on collision.
 *
 * The unique index is still the authority: two concurrent creates can both
 * pass this check, so callers must handle 23505 on insert.
 */
export async function allocateProjectKey(input: {
  organizationId: string;
  name: string;
  requested?: string | null;
}): Promise<string> {
  const requested = input.requested?.trim();

  if (requested) {
    const key = normalizeProjectKey(requested);
    if (!PROJECT_KEY_PATTERN.test(key)) {
      throw new Error(PROJECT_KEY_FORMAT_MESSAGE);
    }
    if (await projectKeyTaken(input.organizationId, key)) {
      throw new Error(
        `Project key ${key} is already used in this organization.`,
      );
    }
    return key;
  }

  const base = deriveProjectKey(input.name);
  if (!(await projectKeyTaken(input.organizationId, base))) return base;

  for (let attempt = 2; attempt < 100; attempt += 1) {
    const suffix = String(attempt);
    const candidate = `${base.slice(0, PROJECT_KEY_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!(await projectKeyTaken(input.organizationId, candidate))) {
      return candidate;
    }
  }

  throw new Error(
    "Couldn't generate a unique project key. Enter one manually.",
  );
}

// The caller's `member` row for this org — the identity every project-level
// check hangs off. Null when they don't belong to the organization at all.
export async function findCallerMembership(
  userId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);

  return row ?? null;
}

const ACCESSIBLE_PROJECT_COLUMNS = {
  id: project.id,
  key: project.key,
  name: project.name,
  description: project.description,
};

/**
 * Every project in the org the caller may open — org owners/admins see all of
 * them, everyone else only the ones they hold a project role on. Feeds the
 * sidebar project switcher, so it is a plain read with no permission throw:
 * no access simply means an empty list.
 *
 * Each row carries the caller's EFFECTIVE permissions on that project, matching
 * requireProjectWorkspace (org owners/admins get the full catalog). The sidebar
 * lists a project's sections without re-fetching on navigation, and the section
 * list has to agree with what the page itself will allow.
 */
export async function listAccessibleProjects(
  organizationId: string,
  userId: string,
): Promise<AccessibleProjectWithPermissions[]> {
  const membership = await findCallerMembership(userId, organizationId);
  if (!membership) return [];

  if (canManageOrg(membership.role)) {
    const rows = await db
      .select(ACCESSIBLE_PROJECT_COLUMNS)
      .from(project)
      .where(eq(project.organizationId, organizationId))
      .orderBy(project.name);
    return rows.map((row) => ({
      ...row,
      permissions: [...PROJECT_PERMISSION_KEYS],
    }));
  }

  const rows = await db
    .select({
      ...ACCESSIBLE_PROJECT_COLUMNS,
      permissions: projectRole.permissions,
    })
    .from(project)
    .innerJoin(projectMember, eq(projectMember.projectId, project.id))
    .innerJoin(projectRole, eq(projectMember.roleId, projectRole.id))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(projectMember.memberId, membership.id),
      ),
    )
    .orderBy(project.name);

  // Stored rows outlive catalog changes, so a key we no longer enforce is
  // dropped here rather than shipped to the client as a section link.
  return rows.map((row) => ({
    ...row,
    permissions: sanitizeProjectPermissions(row.permissions),
  }));
}

/**
 * Resolves a `[projectKey]` route segment. Null covers both "no such project"
 * and "not yours" on purpose — the route renders a 404 either way, so an
 * outsider can't probe which keys exist.
 */
export async function findAccessibleProjectByKey(
  organizationId: string,
  userId: string,
  key: string,
): Promise<AccessibleProject | null> {
  const membership = await findCallerMembership(userId, organizationId);
  if (!membership) return null;

  const normalized = normalizeProjectKey(key);
  if (!normalized) return null;

  if (canManageOrg(membership.role)) {
    const [row] = await db
      .select(ACCESSIBLE_PROJECT_COLUMNS)
      .from(project)
      .where(
        and(
          eq(project.organizationId, organizationId),
          eq(project.key, normalized),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  const [row] = await db
    .select(ACCESSIBLE_PROJECT_COLUMNS)
    .from(project)
    .innerJoin(projectMember, eq(projectMember.projectId, project.id))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(project.key, normalized),
        eq(projectMember.memberId, membership.id),
      ),
    )
    .limit(1);
  return row ?? null;
}

// A projectId is attacker-controlled input, so never trust that it belongs to
// the organization whose permissions were just checked.
export async function assertProjectInOrg(
  projectId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) throw new Error("Project not found.");
}

export async function hasOrgPermission(
  organizationId: string,
  permissions: Record<string, string[]>,
) {
  const apiActor = mcpActor();
  if (apiActor) {
    const membership = await findCallerMembership(
      apiActor.userId,
      organizationId,
    );
    return canManageOrg(membership?.role);
  }
  const { success } = await auth.api.hasPermission({
    headers: await headers(),
    body: { organizationId, permissions },
  });
  return success;
}

async function mcpSessionOrThrow(userId: string) {
  const apiUser = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!apiUser) throw new ProjectPermissionError("Authentication required.");
  // Project actions use the authenticated user's identity (id, email, name),
  // not a browser session token. The API key was already verified at the MCP
  // route, so this is the equivalent server-side principal.
  return { user: apiUser } as Awaited<ReturnType<typeof requireAuth>>;
}

// The caller's permission keys on one project, via their assigned role.
// Null when they hold no role on it.
export async function loadCallerProjectPermissions(
  organizationId: string,
  projectId: string,
  userId: string,
): Promise<ProjectPermissionKey[] | null> {
  const membership = await findCallerMembership(userId, organizationId);
  if (!membership) return null;

  const [row] = await db
    .select({ permissions: projectRole.permissions })
    .from(projectMember)
    .innerJoin(projectRole, eq(projectMember.roleId, projectRole.id))
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.memberId, membership.id),
      ),
    )
    .limit(1);

  return row?.permissions ?? null;
}

// Two-step gate: org owners/admins bypass via Better Auth's access control,
// everyone else needs the permission on their own project role.
export async function requireProjectPermission(
  organizationId: string,
  projectId: string,
  permission: ProjectPermissionKey,
  orgBypass: Record<string, string[]>,
  denialMessage: string,
) {
  const apiActor = mcpActor();
  const session = apiActor
    ? await mcpSessionOrThrow(apiActor.userId)
    : await requireAuth();
  await assertProjectInOrg(projectId, organizationId);

  const apiMembership = apiActor
    ? await findCallerMembership(apiActor.userId, organizationId)
    : null;
  if (
    apiActor
      ? canManageOrg(apiMembership?.role)
      : await hasOrgPermission(organizationId, orgBypass)
  )
    return session;

  const permissions = await loadCallerProjectPermissions(
    organizationId,
    projectId,
    session.user.id,
  );
  if (projectRoleCan(permissions, permission)) return session;

  throw new ProjectPermissionError(denialMessage);
}

// A role is assignable on a project when it belongs to the same organization
// and is either an org catalog role or local to that exact project. The foreign
// key alone does not prevent assigning another project's local role.
export function assertRoleUsableOn(
  role: { organizationId: string; projectId: string | null },
  organizationId: string,
  projectId: string,
) {
  const usable =
    role.organizationId === organizationId &&
    (role.projectId === null || role.projectId === projectId);
  if (!usable) throw new Error("That role isn't available on this project.");
}
