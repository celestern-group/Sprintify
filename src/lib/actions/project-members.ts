"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { member, project, projectMember, projectRole, user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { syncProjectMemberCapacityRows } from "@/lib/capacity-sync";
import { scheduleNotifications } from "@/lib/notifications";
import {
  assertProjectInOrg,
  assertRoleUsableOn,
  findCallerMembership,
  isUniqueViolation,
  requireProjectPermission,
} from "@/lib/project-access";
import { ensureOrganizationProjectRoles } from "@/lib/project-role-seed";
import { requireAuth } from "@/lib/session";

function revalidateProjectMembers() {
  revalidatePath("/manage-org/[slug]/projects/[projectId]", "page");
  revalidatePath("/manage-org/[slug]/projects/[projectId]/roles", "page");
}

const MEMBER_MANAGE_BYPASS = { projectMember: ["create"] };

async function requireProjectMemberManage(
  organizationId: string,
  projectId: string,
) {
  return requireProjectPermission(
    organizationId,
    projectId,
    "member:manage",
    MEMBER_MANAGE_BYPASS,
    "You don't have permission to manage this project's members.",
  );
}

// Resolves the role and proves it's usable here. The foreign key only proves
// the role exists — not that it belongs to this org or this project.
async function resolveAssignableRole(input: {
  organizationId: string;
  projectId: string;
  roleId: string;
}) {
  const [role] = await db
    .select({
      id: projectRole.id,
      organizationId: projectRole.organizationId,
      projectId: projectRole.projectId,
    })
    .from(projectRole)
    .where(eq(projectRole.id, input.roleId))
    .limit(1);

  if (!role) throw new Error("Unknown project role.");
  assertRoleUsableOn(role, input.organizationId, input.projectId);
  return role;
}

async function defaultRoleId(organizationId: string) {
  await ensureOrganizationProjectRoles(organizationId);
  const [role] = await db
    .select({ id: projectRole.id })
    .from(projectRole)
    .where(
      and(
        eq(projectRole.organizationId, organizationId),
        eq(projectRole.isDefault, true),
      ),
    )
    .limit(1);

  if (!role) {
    throw new Error("This organization has no default project role set.");
  }
  return role.id;
}

export async function getProjectMembers(input: {
  organizationId: string;
  projectId: string;
}) {
  const session = await requireAuth();

  const membership = await findCallerMembership(
    session.user.id,
    input.organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }
  await assertProjectInOrg(input.projectId, input.organizationId);

  return db
    .select({
      id: projectMember.id,
      memberId: projectMember.memberId,
      roleId: projectMember.roleId,
      roleName: projectRole.name,
      roleKey: projectRole.key,
      rolePermissions: projectRole.permissions,
      createdAt: projectMember.createdAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(projectMember)
    .innerJoin(member, eq(projectMember.memberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(projectRole, eq(projectMember.roleId, projectRole.id))
    .where(eq(projectMember.projectId, input.projectId));
}

const addProjectMemberSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  memberId: z.string(),
  roleId: z.string().optional(),
});

export async function addProjectMember(input: {
  organizationId: string;
  projectId: string;
  memberId: string;
  roleId?: string;
}) {
  const parsed = addProjectMemberSchema.parse(input);
  const session = await requireProjectMemberManage(
    parsed.organizationId,
    parsed.projectId,
  );

  const [target] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.id, parsed.memberId),
        eq(member.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!target) {
    throw new Error("That person isn't a member of this organization.");
  }

  const roleId = parsed.roleId
    ? (
        await resolveAssignableRole({
          organizationId: parsed.organizationId,
          projectId: parsed.projectId,
          roleId: parsed.roleId,
        })
      ).id
    : await defaultRoleId(parsed.organizationId);

  const id = crypto.randomUUID();
  try {
    await db.insert(projectMember).values({
      id,
      projectId: parsed.projectId,
      memberId: parsed.memberId,
      roleId,
    });
  } catch (error) {
    // Unique violation on projectMember_projectId_memberId_uidx.
    if (isUniqueViolation(error)) {
      throw new Error("They're already a member of this project.");
    }
    throw error;
  }

  await recordAudit({
    action: "member.added",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectMember",
    targetId: id,
    metadata: {
      projectId: parsed.projectId,
      memberId: parsed.memberId,
      roleId,
    },
  });
  const [projectRow] = await db
    .select({ key: project.key, name: project.name })
    .from(project)
    .where(eq(project.id, parsed.projectId))
    .limit(1);
  scheduleNotifications({
    organizationId: parsed.organizationId,
    recipientMemberIds: [parsed.memberId],
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      memberId: (
        await findCallerMembership(session.user.id, parsed.organizationId)
      )?.id,
    },
    action: "member.added",
    targetType: "project",
    targetId: parsed.projectId,
    metadata: {
      projectKey: projectRow?.key,
      projectName: projectRow?.name,
    },
  });
  // Someone joining mid-flight needs a capacity row on every sprint that
  // hasn't finished, or they read as "no capacity" in the planning view.
  await syncProjectMemberCapacityRows({
    projectId: parsed.projectId,
    memberId: parsed.memberId,
    action: "add",
  });
  revalidateProjectMembers();
}

const updateProjectMemberRoleSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectMemberId: z.string(),
  roleId: z.string(),
});

export async function updateProjectMemberRole(input: {
  organizationId: string;
  projectId: string;
  projectMemberId: string;
  roleId: string;
}) {
  const parsed = updateProjectMemberRoleSchema.parse(input);
  const session = await requireProjectMemberManage(
    parsed.organizationId,
    parsed.projectId,
  );
  const role = await resolveAssignableRole({
    organizationId: parsed.organizationId,
    projectId: parsed.projectId,
    roleId: parsed.roleId,
  });

  await db
    .update(projectMember)
    .set({ roleId: role.id })
    .where(
      and(
        eq(projectMember.id, parsed.projectMemberId),
        eq(projectMember.projectId, parsed.projectId),
      ),
    );

  await recordAudit({
    action: "member.role_updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectMember",
    targetId: parsed.projectMemberId,
    metadata: { projectId: parsed.projectId, roleId: role.id },
  });
  revalidateProjectMembers();
}

const removeProjectMemberSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectMemberId: z.string(),
});

export async function removeProjectMember(input: {
  organizationId: string;
  projectId: string;
  projectMemberId: string;
}) {
  const parsed = removeProjectMemberSchema.parse(input);
  const session = await requireProjectMemberManage(
    parsed.organizationId,
    parsed.projectId,
  );

  // Read the memberId before deleting — the capacity rows are keyed on it,
  // and after the delete there is nothing left to look it up from.
  const [removed] = await db
    .select({ memberId: projectMember.memberId })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.id, parsed.projectMemberId),
        eq(projectMember.projectId, parsed.projectId),
      ),
    )
    .limit(1);

  await db
    .delete(projectMember)
    .where(
      and(
        eq(projectMember.id, parsed.projectMemberId),
        eq(projectMember.projectId, parsed.projectId),
      ),
    );

  await recordAudit({
    action: "member.removed",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "projectMember",
    targetId: parsed.projectMemberId,
    metadata: { projectId: parsed.projectId, memberId: removed?.memberId },
  });
  if (removed) {
    // Drop them from sprints still in flight so they stop counting toward the
    // total. Completed sprints keep their rows — that is the historical record
    // of who was planned in.
    await syncProjectMemberCapacityRows({
      projectId: parsed.projectId,
      memberId: removed.memberId,
      action: "remove",
    });
  }
  revalidateProjectMembers();
}
