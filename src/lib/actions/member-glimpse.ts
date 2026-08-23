"use server";

import { and, eq } from "drizzle-orm";
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
import { findCallerMembership } from "@/lib/project-access";
import { requireAuth } from "@/lib/session";

export type MemberGlimpse = {
  memberId: string;
  name: string;
  email: string;
  image: string | null;
  /** Better Auth org role: owner / admin / member. */
  orgRole: string;
  joinedAt: Date;
  teams: string[];
  /** The person's role on the project that was asked about, if one was. */
  projectRole: string | null;
};

const schema = z.object({
  memberId: z.string().min(1),
  /** Optional context: on a backlog page, "their role HERE" is the fact worth
      showing, and it can't be derived from the member row alone. */
  projectId: z.string().min(1).optional(),
});

/**
 * The person behind a name, for the hover card — who they are in this org, the
 * teams they're on, and what they can do on the project you're looking at.
 *
 * A read, so there is no audit entry and nothing to revalidate; the contract it
 * DOES have to keep is the org boundary. Anyone can hand this action any member
 * id, so it resolves the target's organization from the row itself and answers
 * only if the CALLER also holds a membership there — a null return covers both
 * "no such member" and "not your org", so it can't be used to probe for ids.
 */
export async function getMemberGlimpse(
  input: z.input<typeof schema>,
): Promise<MemberGlimpse | null> {
  const { memberId, projectId } = schema.parse(input);
  const session = await requireAuth();

  const [row] = await db
    .select({
      memberId: member.id,
      organizationId: member.organizationId,
      orgRole: member.role,
      joinedAt: member.createdAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.id, memberId))
    .limit(1);

  if (!row) return null;

  const caller = await findCallerMembership(
    session.user.id,
    row.organizationId,
  );
  if (!caller) return null;

  const teams = await db
    .select({ name: team.name })
    .from(teamMember)
    .innerJoin(team, eq(teamMember.teamId, team.id))
    .where(eq(teamMember.memberId, memberId));

  // The project half is scoped by BOTH ids: a project id from another org would
  // otherwise name a role the caller has no business seeing.
  let roleName: string | null = null;
  if (projectId) {
    const [projectRow] = await db
      .select({ name: projectRole.name })
      .from(projectMember)
      .innerJoin(projectRole, eq(projectMember.roleId, projectRole.id))
      .where(
        and(
          eq(projectMember.memberId, memberId),
          eq(projectMember.projectId, projectId),
          eq(projectRole.organizationId, row.organizationId),
        ),
      )
      .limit(1);
    roleName = projectRow?.name ?? null;
  }

  return {
    memberId: row.memberId,
    name: row.name,
    email: row.email,
    image: row.image,
    orgRole: row.orgRole,
    joinedAt: row.joinedAt,
    teams: teams.map((entry) => entry.name),
    projectRole: roleName,
  };
}
