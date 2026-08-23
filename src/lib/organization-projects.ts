import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { project } from "@/db/schema";

/**
 * Shared by the org-deletion guard (`beforeDeleteOrganization` in
 * `src/lib/auth.ts`) and the settings danger zone that mirrors it, so the
 * button state and the server rule can't drift apart.
 */
export async function countOrganizationProjects(organizationId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(project)
    .where(eq(project.organizationId, organizationId));
  return row?.value ?? 0;
}

export function organizationHasProjectsMessage(
  organizationName: string,
  projectCount: number,
) {
  return `Delete ${projectCount} ${
    projectCount === 1 ? "project" : "projects"
  } in ${organizationName} before deleting the organization.`;
}
