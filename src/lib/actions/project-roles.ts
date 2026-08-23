"use server";

import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { projectMember, projectRole } from "@/db/schema";
import {
  embeddingSource,
  scheduleEmbedding,
  scheduleEmbeddings,
} from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import {
  assertProjectInOrg,
  findCallerMembership,
  hasOrgPermission,
  isUniqueViolation,
  requireProjectPermission,
} from "@/lib/project-access";
import {
  type ProjectPermissionKey,
  sanitizeProjectPermissions,
  slugifyRoleKey,
} from "@/lib/project-permissions";
import { ensureOrganizationProjectRoles } from "@/lib/project-role-seed";
import { requireAuth } from "@/lib/session";

export type ProjectRoleRow = {
  id: string;
  projectId: string | null;
  key: string;
  name: string;
  description: string | null;
  permissions: ProjectPermissionKey[];
  isDefault: boolean;
  source: "local" | "sap";
  externalId: string | null;
  memberCount: number;
};

const ORG_ROLE_BYPASS = { projectRole: ["create"] };

function revalidateRoles(projectId: string | null) {
  revalidatePath("/manage-org/[slug]/roles", "page");
  if (projectId !== null) {
    revalidatePath("/manage-org/[slug]/projects/[projectId]/roles", "page");
    revalidatePath("/manage-org/[slug]/projects/[projectId]", "page");
  }
}

// Org catalog roles are organization-wide, so only owners/admins may change
// them. Project-local roles are gated separately, in requireRoleScopeAccess.
async function requireOrgRoleAdmin(organizationId: string) {
  await requireAuth();
  if (!(await hasOrgPermission(organizationId, ORG_ROLE_BYPASS))) {
    throw new Error(
      "Only organization owners and admins can manage the role catalog.",
    );
  }
}

// The scope is always derived from the stored row, never from client input —
// otherwise a project admin submits projectId: null and edits the org catalog.
async function requireRoleScopeAccess(
  organizationId: string,
  projectId: string | null,
) {
  if (projectId === null) return requireOrgRoleAdmin(organizationId);
  return requireProjectPermission(
    organizationId,
    projectId,
    "role:manage",
    ORG_ROLE_BYPASS,
    "You don't have permission to manage this project's roles.",
  );
}

async function requireOrgMember(organizationId: string) {
  const session = await requireAuth();
  const membership = await findCallerMembership(
    session.user.id,
    organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }
  return session;
}

async function loadRoleForWrite(organizationId: string, roleId: string) {
  const [role] = await db
    .select()
    .from(projectRole)
    .where(
      and(
        eq(projectRole.id, roleId),
        eq(projectRole.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!role) throw new Error("Role not found.");
  return role;
}

function selectRoleRow() {
  return {
    id: projectRole.id,
    projectId: projectRole.projectId,
    key: projectRole.key,
    name: projectRole.name,
    description: projectRole.description,
    permissions: projectRole.permissions,
    isDefault: projectRole.isDefault,
    source: projectRole.source,
    externalId: projectRole.externalId,
    memberCount: sql<number>`(
      select count(*)::int from ${projectMember}
      where ${projectMember.roleId} = ${projectRole.id}
    )`,
  };
}

export async function listOrgProjectRoles(
  organizationId: string,
): Promise<ProjectRoleRow[]> {
  await requireOrgMember(organizationId);
  await ensureOrganizationProjectRoles(organizationId);

  return db
    .select(selectRoleRow())
    .from(projectRole)
    .where(
      and(
        eq(projectRole.organizationId, organizationId),
        isNull(projectRole.projectId),
      ),
    )
    .orderBy(asc(projectRole.name)) as Promise<ProjectRoleRow[]>;
}

export async function listProjectRoles(input: {
  organizationId: string;
  projectId: string;
}): Promise<{ catalog: ProjectRoleRow[]; local: ProjectRoleRow[] }> {
  await requireOrgMember(input.organizationId);
  await assertProjectInOrg(input.projectId, input.organizationId);
  await ensureOrganizationProjectRoles(input.organizationId);

  const rows = (await db
    .select(selectRoleRow())
    .from(projectRole)
    .where(
      and(
        eq(projectRole.organizationId, input.organizationId),
        sql`(${projectRole.projectId} is null or ${projectRole.projectId} = ${input.projectId})`,
      ),
    )
    .orderBy(asc(projectRole.name))) as ProjectRoleRow[];

  return {
    catalog: rows.filter((row) => row.projectId === null),
    local: rows.filter((row) => row.projectId !== null),
  };
}

// Everything assignable on a project: the org catalog plus that project's own
// roles. This is what the member role pickers render.
export async function listAssignableRoles(input: {
  organizationId: string;
  projectId: string;
}): Promise<ProjectRoleRow[]> {
  const { catalog, local } = await listProjectRoles(input);
  return [...catalog, ...local];
}

const createProjectRoleSchema = z.object({
  organizationId: z.string(),
  projectId: z.string().nullable(),
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
  permissions: z.array(z.string()),
  isDefault: z.boolean().optional(),
});

export async function createProjectRole(input: {
  organizationId: string;
  projectId: string | null;
  name: string;
  description?: string;
  permissions: string[];
  isDefault?: boolean;
}): Promise<{ id: string }> {
  const parsed = createProjectRoleSchema.parse(input);
  await requireRoleScopeAccess(parsed.organizationId, parsed.projectId);
  const session = await requireAuth();

  const name = parsed.name.trim();
  if (!name) throw new Error("Give the role a name.");

  // Derived server-side; never trust a client-supplied key.
  const key = slugifyRoleKey(name);
  if (!key) throw new Error("That name can't be turned into a role key.");

  const isDefault = parsed.projectId === null && parsed.isDefault === true;
  if (parsed.projectId !== null && parsed.isDefault) {
    throw new Error("Only an organization role can be the default.");
  }

  // A project-local role sharing a key with a catalog role would make key-based
  // lookup ambiguous. No index can express this, so check it here.
  if (parsed.projectId !== null) {
    const [clash] = await db
      .select({ id: projectRole.id })
      .from(projectRole)
      .where(
        and(
          eq(projectRole.organizationId, parsed.organizationId),
          isNull(projectRole.projectId),
          eq(projectRole.key, key),
        ),
      )
      .limit(1);
    if (clash) {
      throw new Error(
        "An organization role already uses that name. Pick a different one.",
      );
    }
  }

  const id = crypto.randomUUID();
  const values = {
    id,
    organizationId: parsed.organizationId,
    projectId: parsed.projectId,
    key,
    name,
    description: parsed.description?.trim() || null,
    permissions: sanitizeProjectPermissions(parsed.permissions),
    isDefault,
    source: "local" as const,
  };

  try {
    await db.transaction(async (tx) => {
      if (isDefault) {
        await tx
          .update(projectRole)
          .set({ isDefault: false })
          .where(
            and(
              eq(projectRole.organizationId, parsed.organizationId),
              eq(projectRole.isDefault, true),
            ),
          );
      }
      await tx.insert(projectRole).values(values);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A role with that name already exists here.");
    }
    throw error;
  }

  await recordAudit({
    action: "projectRole.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectRole",
    targetId: id,
    metadata: { name, key, projectId: parsed.projectId, isDefault },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(name, values.description),
    persist: async (result) => {
      await db
        .update(projectRole)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(projectRole.id, id));
    },
  });
  revalidateRoles(parsed.projectId);

  return { id };
}

const updateProjectRoleSchema = z.object({
  organizationId: z.string(),
  roleId: z.string(),
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
  permissions: z.array(z.string()),
  isDefault: z.boolean().optional(),
});

export async function updateProjectRole(input: {
  organizationId: string;
  roleId: string;
  name: string;
  description?: string;
  permissions: string[];
  isDefault?: boolean;
}): Promise<void> {
  const parsed = updateProjectRoleSchema.parse(input);
  const role = await loadRoleForWrite(parsed.organizationId, parsed.roleId);
  await requireRoleScopeAccess(parsed.organizationId, role.projectId);
  const session = await requireAuth();

  const name = parsed.name.trim();
  if (!name) throw new Error("Give the role a name.");

  const makeDefault = role.projectId === null && parsed.isDefault === true;
  if (role.projectId !== null && parsed.isDefault) {
    throw new Error("Only an organization role can be the default.");
  }
  // Clearing the default directly would leave the org with no reassign target.
  if (role.isDefault && parsed.isDefault === false) {
    throw new Error(
      "Make another role the default instead of unsetting this one.",
    );
  }

  try {
    await db.transaction(async (tx) => {
      if (makeDefault && !role.isDefault) {
        await tx
          .update(projectRole)
          .set({ isDefault: false })
          .where(
            and(
              eq(projectRole.organizationId, parsed.organizationId),
              eq(projectRole.isDefault, true),
            ),
          );
      }
      await tx
        .update(projectRole)
        // `key` is deliberately absent — it's the stable external mapping.
        .set({
          name,
          description: parsed.description?.trim() || null,
          permissions: sanitizeProjectPermissions(parsed.permissions),
          isDefault: makeDefault || role.isDefault,
        })
        .where(eq(projectRole.id, role.id));
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A role with that name already exists here.");
    }
    throw error;
  }

  await recordAudit({
    action: "projectRole.updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectRole",
    targetId: role.id,
    metadata: { name, projectId: role.projectId },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(name, parsed.description),
    persist: async (result) => {
      await db
        .update(projectRole)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(projectRole.id, role.id));
    },
  });
  revalidateRoles(role.projectId);
}

const setDefaultProjectRoleSchema = z.object({
  organizationId: z.string(),
  roleId: z.string(),
});

export async function setDefaultProjectRole(input: {
  organizationId: string;
  roleId: string;
}): Promise<void> {
  const parsed = setDefaultProjectRoleSchema.parse(input);
  await requireOrgRoleAdmin(parsed.organizationId);
  const session = await requireAuth();
  const role = await loadRoleForWrite(parsed.organizationId, parsed.roleId);
  if (role.projectId !== null) {
    throw new Error("Only an organization role can be the default.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(projectRole)
      .set({ isDefault: false })
      .where(
        and(
          eq(projectRole.organizationId, parsed.organizationId),
          eq(projectRole.isDefault, true),
          ne(projectRole.id, role.id),
        ),
      );
    await tx
      .update(projectRole)
      .set({ isDefault: true })
      .where(eq(projectRole.id, role.id));
  });

  await recordAudit({
    action: "projectRole.set_default",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectRole",
    targetId: role.id,
    metadata: { name: role.name },
  });
  revalidateRoles(null);
}

export async function getProjectRoleDeletionImpact(input: {
  organizationId: string;
  roleId: string;
}): Promise<{ holders: number; fallbackRoleName: string | null }> {
  const role = await loadRoleForWrite(input.organizationId, input.roleId);
  await requireRoleScopeAccess(input.organizationId, role.projectId);

  const [{ value: holders }] = await db
    .select({ value: count() })
    .from(projectMember)
    .where(eq(projectMember.roleId, role.id));

  const [fallback] = await db
    .select({ name: projectRole.name })
    .from(projectRole)
    .where(
      and(
        eq(projectRole.organizationId, input.organizationId),
        eq(projectRole.isDefault, true),
      ),
    )
    .limit(1);

  return { holders, fallbackRoleName: fallback?.name ?? null };
}

const deleteProjectRoleSchema = z.object({
  organizationId: z.string(),
  roleId: z.string(),
});

export async function deleteProjectRole(input: {
  organizationId: string;
  roleId: string;
}): Promise<void> {
  const parsed = deleteProjectRoleSchema.parse(input);
  const role = await loadRoleForWrite(parsed.organizationId, parsed.roleId);
  await requireRoleScopeAccess(parsed.organizationId, role.projectId);
  const session = await requireAuth();

  await db.transaction(async (tx) => {
    // FOR UPDATE closes the window where a concurrent addProjectMember assigns
    // this role between the reassignment below and the delete.
    const [target] = await tx
      .select()
      .from(projectRole)
      .where(eq(projectRole.id, role.id))
      .for("update")
      .limit(1);
    if (!target) throw new Error("Role not found.");

    if (target.isDefault) {
      throw new Error(
        "This is the default role. Make another role the default before deleting it.",
      );
    }

    const [fallback] = await tx
      .select({ id: projectRole.id })
      .from(projectRole)
      .where(
        and(
          eq(projectRole.organizationId, parsed.organizationId),
          eq(projectRole.isDefault, true),
        ),
      )
      .limit(1);
    if (!fallback) {
      throw new Error(
        "This organization has no default role to reassign people to.",
      );
    }

    // Reassign before deleting: the foreign key is NO ACTION, so any remaining
    // holder aborts the transaction rather than losing their membership.
    await tx
      .update(projectMember)
      .set({ roleId: fallback.id })
      .where(eq(projectMember.roleId, target.id));

    await tx.delete(projectRole).where(eq(projectRole.id, target.id));
  });

  await recordAudit({
    action: "projectRole.deleted",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectRole",
    targetId: role.id,
    metadata: { name: role.name, projectId: role.projectId },
  });
  revalidateRoles(role.projectId);
}

export type ExternalRoleInput = {
  externalId: string;
  key: string;
  name: string;
  description?: string;
  permissions: string[];
};

// The ingress point for an external HR system (SAP) that owns role definitions.
// Not reachable from any route yet — the authenticated endpoint is deferred, but
// the shape and its conflict target are fixed now because adding the unique
// index later against live data is the expensive part.
//
// Scope is always the org catalog: an external system has no notion of a
// project-local role. Additive by design — roles absent from a payload are left
// alone, never deleted, so a partial sync can't strip anyone's access. It never
// touches isDefault, which stays an in-app decision.
const syncExternalProjectRolesSchema = z.object({
  organizationId: z.string(),
  source: z.literal("sap"),
  roles: z.array(
    z.object({
      externalId: z.string(),
      key: z.string(),
      name: z.string().max(200),
      description: z.string().max(2000).optional(),
      permissions: z.array(z.string()),
    }),
  ),
});

export async function syncExternalProjectRoles(input: {
  organizationId: string;
  source: "sap";
  roles: ExternalRoleInput[];
}): Promise<{ written: number; skippedPermissions: string[] }> {
  const parsed = syncExternalProjectRolesSchema.parse(input);
  await requireOrgRoleAdmin(parsed.organizationId);
  const session = await requireAuth();

  const skipped = new Set<string>();
  const values = parsed.roles.map((role) => {
    const permissions = sanitizeProjectPermissions(role.permissions);
    for (const candidate of role.permissions) {
      if (!(permissions as string[]).includes(candidate)) {
        skipped.add(candidate);
      }
    }
    return {
      id: crypto.randomUUID(),
      organizationId: parsed.organizationId,
      projectId: null,
      key: slugifyRoleKey(role.key || role.name),
      name: role.name,
      description: role.description ?? null,
      permissions,
      isDefault: false,
      source: parsed.source,
      externalId: role.externalId,
    };
  });

  // `setWhere` keeps a re-sync of unchanged rows from touching them at all, so
  // `returning` yields exactly the rows that were inserted or whose text
  // actually moved — which is exactly the set needing a (re-)embedding. Without
  // it a nightly sync would re-embed every role on every run.
  let written: { id: string; name: string; description: string | null }[] = [];
  if (values.length > 0) {
    written = await db
      .insert(projectRole)
      .values(values)
      .onConflictDoUpdate({
        target: [projectRole.organizationId, projectRole.externalId],
        targetWhere: sql`${projectRole.externalId} is not null`,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          permissions: sql`excluded.permissions`,
          source: sql`excluded.source`,
          updatedAt: new Date(),
        },
        setWhere: sql`${projectRole.name} is distinct from excluded.name
          or ${projectRole.description} is distinct from excluded.description
          or ${projectRole.permissions} is distinct from excluded.permissions
          or ${projectRole.source} is distinct from excluded.source`,
      })
      .returning({
        id: projectRole.id,
        name: projectRole.name,
        description: projectRole.description,
      });
  }

  await recordAudit({
    action: "projectRole.synced",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectRole",
    targetId: null,
    metadata: {
      source: parsed.source,
      written: values.length,
      skippedPermissions: [...skipped],
    },
  });
  scheduleEmbeddings({
    organizationId: parsed.organizationId,
    items: written.map((row) => ({
      id: row.id,
      text: embeddingSource(row.name, row.description),
    })),
    persist: async (result, ids) => {
      await db
        .update(projectRole)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(inArray(projectRole.id, ids));
    },
  });
  revalidateRoles(null);

  return { written: values.length, skippedPermissions: [...skipped] };
}
