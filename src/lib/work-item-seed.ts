import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { project, workflowStatus, workItemType } from "@/db/schema";
import { SEED_WORK_ITEM_TYPES, SEED_WORKFLOW_STATUSES } from "@/lib/work-items";

// Mirrors src/lib/project-role-seed.ts: a new organization gets its starting
// work item vocabulary, a new project gets its starting flow. Idempotent —
// the unique indexes make a repeat run a no-op.

export async function seedOrganizationWorkItemTypes(organizationId: string) {
  await db
    .insert(workItemType)
    .values(
      SEED_WORK_ITEM_TYPES.map((type) => ({
        organizationId,
        key: type.key,
        name: type.name,
        description: type.description,
        hierarchyLevel: type.hierarchyLevel,
        tone: type.tone,
        icon: type.icon,
        isDefault: type.isDefault,
        tracksDefect: type.tracksDefect,
        position: type.position,
        source: "local" as const,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Not every organization is born through the afterCreateOrganization hook (SSO
 * provisioning and direct adapter writes bypass it), and an org with no types
 * can't create a single work item — so read paths call this to self-heal
 * rather than dead-end. Same contract as ensureOrganizationProjectRoles.
 */
export async function ensureOrganizationWorkItemTypes(organizationId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(workItemType)
    .where(eq(workItemType.organizationId, organizationId));

  if (value === 0) await seedOrganizationWorkItemTypes(organizationId);
}

export async function seedProjectWorkflowStatuses(input: {
  organizationId: string;
  projectId: string;
}) {
  await db
    .insert(workflowStatus)
    .values(
      SEED_WORKFLOW_STATUSES.map((status) => ({
        organizationId: input.organizationId,
        projectId: input.projectId,
        name: status.name,
        description: status.description,
        category: status.category,
        position: status.position,
        isDefault: status.isDefault,
      })),
    )
    .onConflictDoNothing();
}

/** A project with no statuses has no board columns; self-heal on read. */
export async function ensureProjectWorkflowStatuses(projectId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(workflowStatus)
    .where(eq(workflowStatus.projectId, projectId));
  if (value > 0) return;

  const [row] = await db
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) return;

  await seedProjectWorkflowStatuses({
    organizationId: row.organizationId,
    projectId,
  });
}
