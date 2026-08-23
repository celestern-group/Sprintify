"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { project } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import { allocateProjectKey, isUniqueViolation } from "@/lib/project-access";
import { requireAdminAction } from "@/lib/session";

export async function listOrganizationProjects(organizationId: string) {
  await requireAdminAction();

  return db
    .select()
    .from(project)
    .where(eq(project.organizationId, organizationId))
    .orderBy(project.name);
}

const createOrganizationProjectSchema = z.object({
  organizationId: z.string(),
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
  key: z.string().max(64).optional(),
});

export async function createOrganizationProject(input: {
  organizationId: string;
  name: string;
  description?: string;
  key?: string;
}) {
  const parsed = createOrganizationProjectSchema.parse(input);
  const session = await requireAdminAction();
  await assertPlatformNotLocked();

  const key = await allocateProjectKey({
    organizationId: parsed.organizationId,
    name: parsed.name,
    requested: parsed.key,
  });

  const id = crypto.randomUUID();
  try {
    await db.insert(project).values({
      id,
      organizationId: parsed.organizationId,
      key,
      name: parsed.name,
      description: parsed.description || null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(
        `Project key ${key} is already used in this organization.`,
      );
    }
    throw error;
  }

  await recordAudit({
    action: "project.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: id,
    metadata: { name: parsed.name, key },
  });
  revalidatePath("/admin/organizations/[id]", "page");
}

const updateOrganizationProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
});

export async function updateOrganizationProject(input: {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
}) {
  const parsed = updateOrganizationProjectSchema.parse(input);
  const session = await requireAdminAction();

  await db
    .update(project)
    .set({ name: parsed.name, description: parsed.description || null })
    .where(
      and(
        eq(project.id, parsed.id),
        eq(project.organizationId, parsed.organizationId),
      ),
    );

  await recordAudit({
    action: "project.updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: parsed.id,
    metadata: { name: parsed.name },
  });
  revalidatePath("/admin/organizations/[id]", "page");
}

const deleteOrganizationProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
});

export async function deleteOrganizationProject(input: {
  id: string;
  organizationId: string;
}) {
  const parsed = deleteOrganizationProjectSchema.parse(input);
  const session = await requireAdminAction();

  await db
    .delete(project)
    .where(
      and(
        eq(project.id, parsed.id),
        eq(project.organizationId, parsed.organizationId),
      ),
    );

  await recordAudit({
    action: "project.deleted",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: parsed.id,
  });
  revalidatePath("/admin/organizations/[id]", "page");
}
