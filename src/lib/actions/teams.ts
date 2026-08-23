"use server";

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  member,
  projectMember,
  projectRole,
  team,
  teamMember,
  user,
} from "@/db/schema";
import {
  embeddingSource,
  scheduleEmbedding,
  scheduleEmbeddings,
} from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import { seedProjectSprintCapacities } from "@/lib/capacity-sync";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import {
  findCallerMembership,
  hasOrgPermission,
  isUniqueViolation,
  requireProjectPermission,
} from "@/lib/project-access";
import { ensureOrganizationProjectRoles } from "@/lib/project-role-seed";
import { requireAuth } from "@/lib/session";
import {
  addTeamToProjectSchema,
  createTeamSchema,
  syncExternalTeamsSchema,
  teamMemberSchema,
  updateTeamSchema,
} from "@/lib/validation/teams";

function revalidateTeams() {
  revalidatePath("/manage-org/[slug]/teams", "page");
}

// Org-level gate for team management. Teams never grant access, so this is
// purely "who may manage the groups" — owners/admins by default (see orgRoles
// in src/lib/permissions.ts).
async function requireTeamPermission(
  organizationId: string,
  action: "create" | "update" | "delete",
) {
  const session = await requireAuth();
  const allowed = await hasOrgPermission(organizationId, { team: [action] });
  if (!allowed) {
    throw new Error(`You don't have permission to ${action} teams.`);
  }
  return session;
}

// Scope-derive the org from the stored team row, so a forged teamId can't be
// paired with an arbitrary organizationId to cross tenants.
async function loadTeamOrThrow(teamId: string) {
  const [row] = await db
    .select({
      id: team.id,
      organizationId: team.organizationId,
      name: team.name,
    })
    .from(team)
    .where(eq(team.id, teamId))
    .limit(1);
  if (!row) throw new Error("Team not found.");
  return row;
}

async function assertMemberInOrg(memberId: string, organizationId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  if (!row) {
    throw new Error("That person isn't a member of this organization.");
  }
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

export async function getTeams(organizationId: string) {
  const session = await requireAuth();
  const membership = await findCallerMembership(
    session.user.id,
    organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }

  const teams = await db
    .select({
      id: team.id,
      name: team.name,
      description: team.description,
      source: team.source,
      createdAt: team.createdAt,
    })
    .from(team)
    .where(eq(team.organizationId, organizationId))
    .orderBy(team.name);

  if (teams.length === 0) return [];

  const counts = await db
    .select({ teamId: teamMember.teamId, value: count() })
    .from(teamMember)
    .where(
      inArray(
        teamMember.teamId,
        teams.map((t) => t.id),
      ),
    )
    .groupBy(teamMember.teamId);
  const countByTeam = new Map(counts.map((c) => [c.teamId, c.value]));

  return teams.map((t) => ({ ...t, memberCount: countByTeam.get(t.id) ?? 0 }));
}

export async function getTeamMembers(teamId: string) {
  const session = await requireAuth();
  const team_ = await loadTeamOrThrow(teamId);
  const membership = await findCallerMembership(
    session.user.id,
    team_.organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }

  return db
    .select({
      id: teamMember.id,
      memberId: teamMember.memberId,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(teamMember)
    .innerJoin(member, eq(teamMember.memberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(teamMember.teamId, teamId));
}

export async function createTeam(input: {
  organizationId: string;
  name: string;
  description?: string;
}) {
  const parsed = createTeamSchema.parse(input);
  const session = await requireTeamPermission(parsed.organizationId, "create");
  await assertPlatformNotLocked();

  const id = crypto.randomUUID();
  try {
    await db.insert(team).values({
      id,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description || null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A team with that name already exists.");
    }
    throw error;
  }

  await recordAudit({
    action: "team.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "team",
    targetId: id,
    metadata: { name: parsed.name },
  });
  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(team)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(team.id, id));
    },
  });
  revalidateTeams();
  return id;
}

export async function updateTeam(input: {
  teamId: string;
  name: string;
  description?: string;
}) {
  const parsed = updateTeamSchema.parse(input);
  const existing = await loadTeamOrThrow(parsed.teamId);
  const session = await requireTeamPermission(
    existing.organizationId,
    "update",
  );

  try {
    await db
      .update(team)
      .set({
        name: parsed.name,
        description: parsed.description || null,
      })
      .where(eq(team.id, parsed.teamId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A team with that name already exists.");
    }
    throw error;
  }

  await recordAudit({
    action: "team.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "team",
    targetId: parsed.teamId,
    metadata: { name: parsed.name },
  });
  scheduleEmbedding({
    organizationId: existing.organizationId,
    text: embeddingSource(parsed.name, parsed.description),
    persist: async (result) => {
      await db
        .update(team)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(team.id, parsed.teamId));
    },
  });
  revalidateTeams();
}

export async function deleteTeam(input: { teamId: string }) {
  const teamId = z.string().min(1).parse(input.teamId);
  const existing = await loadTeamOrThrow(teamId);
  const session = await requireTeamPermission(
    existing.organizationId,
    "delete",
  );

  await db.delete(team).where(eq(team.id, teamId));

  await recordAudit({
    action: "team.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "team",
    targetId: teamId,
    metadata: { name: existing.name },
  });
  revalidateTeams();
}

export async function addTeamMember(input: {
  teamId: string;
  memberId: string;
}) {
  const parsed = teamMemberSchema.parse(input);
  const existing = await loadTeamOrThrow(parsed.teamId);
  const session = await requireTeamPermission(
    existing.organizationId,
    "update",
  );
  await assertMemberInOrg(parsed.memberId, existing.organizationId);

  const id = crypto.randomUUID();
  try {
    await db.insert(teamMember).values({
      id,
      teamId: parsed.teamId,
      memberId: parsed.memberId,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("They're already on this team.");
    }
    throw error;
  }

  await recordAudit({
    action: "team.member_added",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "team",
    targetId: parsed.teamId,
    metadata: { memberId: parsed.memberId },
  });
  revalidateTeams();
}

export async function removeTeamMember(input: {
  teamId: string;
  memberId: string;
}) {
  const parsed = teamMemberSchema.parse(input);
  const existing = await loadTeamOrThrow(parsed.teamId);
  const session = await requireTeamPermission(
    existing.organizationId,
    "update",
  );

  await db
    .delete(teamMember)
    .where(
      and(
        eq(teamMember.teamId, parsed.teamId),
        eq(teamMember.memberId, parsed.memberId),
      ),
    );

  await recordAudit({
    action: "team.member_removed",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "team",
    targetId: parsed.teamId,
    metadata: { memberId: parsed.memberId },
  });
  revalidateTeams();
}

// Bulk-adds a team's members to a project as individual project members with
// the default role. Teams stay OUT of access control — this just expands to
// projectMember rows; access still flows through project membership. Gated by
// the same member:manage permission as adding a single member.
export async function addTeamToProject(input: {
  teamId: string;
  projectId: string;
}) {
  const parsed = addTeamToProjectSchema.parse(input);
  const existing = await loadTeamOrThrow(parsed.teamId);
  const session = await requireProjectPermission(
    existing.organizationId,
    parsed.projectId,
    "member:manage",
    { projectMember: ["create"] },
    "You don't have permission to manage this project's members.",
  );

  const members = await db
    .select({ memberId: teamMember.memberId })
    .from(teamMember)
    .where(eq(teamMember.teamId, parsed.teamId));
  if (members.length === 0) {
    return { added: 0, skipped: 0 };
  }

  const roleId = await defaultRoleId(existing.organizationId);
  const inserted = await db
    .insert(projectMember)
    .values(
      members.map((m) => ({
        id: crypto.randomUUID(),
        projectId: parsed.projectId,
        memberId: m.memberId,
        roleId,
      })),
    )
    .onConflictDoNothing({
      target: [projectMember.projectId, projectMember.memberId],
    })
    .returning({ id: projectMember.id });

  const added = inserted.length;
  const skipped = members.length - added;

  await recordAudit({
    action: "team.added_to_project",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: parsed.projectId,
    metadata: { teamId: parsed.teamId, added, skipped },
  });

  // Everyone newly on the project needs a capacity row on the sprints that
  // haven't finished. seedSprintCapacities is idempotent, so one pass per
  // in-flight sprint is cheaper than one pass per member.
  if (added > 0) {
    await seedProjectSprintCapacities(parsed.projectId);
  }

  revalidatePath("/manage-org/[slug]/projects/[projectId]", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
  return { added, skipped };
}

// Upsert teams from an external HR system by externalId. Mirrors
// syncExternalProjectRoles; not wired to any route yet.
export async function syncExternalTeams(input: {
  organizationId: string;
  source: "sap";
  teams: { externalId: string; name: string; description?: string }[];
}) {
  const parsed = syncExternalTeamsSchema.parse(input);
  const session = await requireTeamPermission(parsed.organizationId, "create");

  const values = parsed.teams.map((t) => ({
    id: crypto.randomUUID(),
    organizationId: parsed.organizationId,
    name: t.name,
    description: t.description || null,
    source: parsed.source,
    externalId: t.externalId,
  }));

  // `setWhere` keeps a re-sync of unchanged rows from touching them at all, so
  // `returning` yields exactly the rows that were inserted or whose text
  // actually moved — which is exactly the set needing a (re-)embedding. Without
  // it a nightly sync would re-embed every team on every run.
  const written = await db
    .insert(team)
    .values(values)
    .onConflictDoUpdate({
      target: [team.organizationId, team.externalId],
      targetWhere: sql`${team.externalId} is not null`,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        source: sql`excluded.source`,
        updatedAt: new Date(),
      },
      setWhere: sql`${team.name} is distinct from excluded.name
        or ${team.description} is distinct from excluded.description
        or ${team.source} is distinct from excluded.source`,
    })
    .returning({
      id: team.id,
      name: team.name,
      description: team.description,
    });

  await recordAudit({
    action: "team.synced",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: parsed.organizationId,
    metadata: { source: parsed.source, written: values.length },
  });
  scheduleEmbeddings({
    organizationId: parsed.organizationId,
    items: written.map((row) => ({
      id: row.id,
      text: embeddingSource(row.name, row.description),
    })),
    persist: async (result, ids) => {
      await db
        .update(team)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(inArray(team.id, ids));
    },
  });
  revalidateTeams();
  return { written: values.length };
}
