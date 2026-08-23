import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectRole } from "@/db/schema";
import { SEED_PROJECT_ROLES } from "@/lib/project-permissions";

// Gives an organization its starting role catalog. Idempotent — the partial
// unique indexes make a repeat run a no-op — so it's safe to call defensively.
export async function seedOrganizationProjectRoles(organizationId: string) {
  await db
    .insert(projectRole)
    .values(
      SEED_PROJECT_ROLES.map((role) => ({
        id: crypto.randomUUID(),
        organizationId,
        projectId: null,
        key: role.key,
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        isDefault: role.isDefault,
        source: "local" as const,
      })),
    )
    .onConflictDoNothing();
}

// Not every organization is born through the afterCreateOrganization hook — SSO
// provisioning and any direct adapter write bypass it. An org with no roles has
// nothing assignable, so read paths call this to self-heal rather than dead-end.
export async function ensureOrganizationProjectRoles(organizationId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(projectRole)
    .where(eq(projectRole.organizationId, organizationId));

  if (value === 0) await seedOrganizationProjectRoles(organizationId);
}
