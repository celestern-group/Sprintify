"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { project } from "@/db/schema";
import { embeddingSource, scheduleEmbedding } from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import { allocateProjectKey, isUniqueViolation } from "@/lib/project-access";
import { requireAuth } from "@/lib/session";
import { seedProjectWorkflowStatuses } from "@/lib/work-item-seed";

async function requireProjectPermission(
  organizationId: string,
  action: "create" | "update" | "delete",
) {
  const session = await requireAuth();

  const { success } = await auth.api.hasPermission({
    headers: await headers(),
    body: {
      organizationId,
      permissions: { project: [action] },
    },
  });
  if (!success) {
    throw new Error(`You don't have permission to ${action} projects.`);
  }

  return session;
}

export async function getProjects(organizationId: string) {
  await requireAuth();

  return db
    .select()
    .from(project)
    .where(eq(project.organizationId, organizationId));
}

export async function getProject(input: {
  organizationId: string;
  projectId: string;
}) {
  await requireAuth();

  const [row] = await db
    .select()
    .from(project)
    .where(
      and(
        eq(project.id, input.projectId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  return row ?? null;
}

const createProjectSchema = z.object({
  organizationId: z.string(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  // Optional: derived from the name when the caller doesn't supply one.
  key: z.string().max(64).optional(),
});

export async function createProject(input: {
  organizationId: string;
  name: string;
  description?: string;
  key?: string;
}) {
  const parsed = createProjectSchema.parse(input);
  const session = await requireProjectPermission(
    input.organizationId,
    "create",
  );
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
    // Two concurrent creates can both clear allocateProjectKey's check; the
    // unique index is what actually decides.
    if (isUniqueViolation(error)) {
      throw new Error(
        `Project key ${key} is already used in this organization.`,
      );
    }
    throw error;
  }

  // A project with no statuses has no board columns and can hold no items, so
  // the flow is seeded with the project itself. Best-effort: read paths call
  // ensureProjectWorkflowStatuses as a backstop, and failing the create over
  // seeding would be worse than a project that self-heals on first open.
  try {
    await seedProjectWorkflowStatuses({
      organizationId: parsed.organizationId,
      projectId: id,
    });
  } catch (error) {
    console.error("Failed to seed workflow statuses:", error);
  }

  await recordAudit({
    action: "project.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: id,
    metadata: { name: parsed.name, key },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(project)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(project.id, id));
    },
  });
  revalidatePath("/manage-org/[slug]/projects", "page");
}

// `key` is deliberately absent: it is immutable after create, because URLs and
// references made from it would otherwise break.
const updateProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export async function updateProject(input: {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
}) {
  const parsed = updateProjectSchema.parse(input);
  const session = await requireProjectPermission(
    input.organizationId,
    "update",
  );

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
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(project)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(project.id, input.id));
    },
  });
  revalidatePath("/manage-org/[slug]/projects", "page");
}

export async function deleteProject(input: {
  id: string;
  organizationId: string;
}) {
  const session = await requireProjectPermission(
    input.organizationId,
    "delete",
  );

  await db
    .delete(project)
    .where(
      and(
        eq(project.id, input.id),
        eq(project.organizationId, input.organizationId),
      ),
    );

  await recordAudit({
    action: "project.deleted",
    organizationId: input.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: input.id,
  });
  revalidatePath("/manage-org/[slug]/projects", "page");
}
