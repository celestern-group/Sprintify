import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ProjectMembersPanel } from "@/components/org/project-members-panel";
import { getProjectMembers } from "@/lib/actions/project-members";
import { listAssignableRoles } from "@/lib/actions/project-roles";
import { getTeams } from "@/lib/actions/teams";
import { auth } from "@/lib/auth";

export default async function ProjectMembersPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const organization = await auth.api.getFullOrganization({
    headers: await headers(),
    query: { organizationSlug: slug },
  });

  if (!organization) {
    notFound();
  }

  const [members, roles, teams] = await Promise.all([
    getProjectMembers({ organizationId: organization.id, projectId }),
    listAssignableRoles({ organizationId: organization.id, projectId }),
    getTeams(organization.id),
  ]);

  return (
    <ProjectMembersPanel
      organizationId={organization.id}
      projectId={projectId}
      orgMembers={organization.members.map((member) => ({
        id: member.id,
        name: member.user.name,
        email: member.user.email,
      }))}
      roles={roles}
      initialMembers={members}
      teams={teams.map((team) => ({ id: team.id, name: team.name }))}
    />
  );
}
