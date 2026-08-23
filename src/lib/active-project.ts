import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { session as sessionTable } from "@/db/schema";
import {
  type AccessibleProjectWithPermissions,
  listAccessibleProjects,
} from "@/lib/project-access";

/**
 * The session's "current project", modelled on Better Auth's
 * activeOrganizationId: a column on `session`, written server-side whenever the
 * caller lands inside a project, read by the pages that have no project segment
 * of their own (/app/[orgSlug]/availability) and by /app/[orgSlug], which
 * redirects into it.
 *
 * It is a *pointer*, never a grant — every read re-resolves it against the
 * projects the caller may actually open, so a revoked or deleted project falls
 * back to the first accessible one instead of leaking anything.
 */

/** Cheapest possible write: only touches the row when the pointer moved. */
export async function setActiveProject(input: {
  sessionId: string;
  currentActiveProjectId: string | null | undefined;
  projectId: string;
}): Promise<void> {
  if (input.currentActiveProjectId === input.projectId) return;

  await db
    .update(sessionTable)
    .set({ activeProjectId: input.projectId })
    .where(eq(sessionTable.id, input.sessionId));
}

/**
 * The project an org-level page should render as, or null when the caller can
 * open none. Prefers the session pointer, falls back to the first accessible
 * project (listAccessibleProjects orders by name) so a fresh session still
 * lands somewhere sensible.
 */
const resolve = cache(
  async (
    organizationId: string,
    userId: string,
    // Positional primitives, not an options object: React's cache() keys on
    // argument identity, so an object literal would miss on every call and the
    // layout would re-query what the page just read.
    activeProjectId: string | null,
  ): Promise<AccessibleProjectWithPermissions | null> => {
    const projects = await listAccessibleProjects(organizationId, userId);
    if (projects.length === 0) return null;

    const pinned = activeProjectId
      ? projects.find((candidate) => candidate.id === activeProjectId)
      : undefined;

    return pinned ?? projects[0];
  },
);

export function resolveActiveProject(input: {
  organizationId: string;
  userId: string;
  activeProjectId: string | null | undefined;
}): Promise<AccessibleProjectWithPermissions | null> {
  return resolve(
    input.organizationId,
    input.userId,
    input.activeProjectId ?? null,
  );
}
