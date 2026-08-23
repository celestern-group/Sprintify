import { headers } from "next/headers";
import { TeamsPanel } from "@/components/org/teams-panel";
import { getTeams } from "@/lib/actions/teams";
import { auth } from "@/lib/auth";

export default async function OrgTeamsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const organization = await auth.api.getFullOrganization({
    headers: await headers(),
    query: { organizationSlug: slug },
  });

  if (!organization) {
    return null;
  }

  const teams = await getTeams(organization.id);

  return (
    <TeamsPanel
      organizationId={organization.id}
      organizationName={organization.name}
      initialTeams={teams}
      orgMembers={organization.members.map((member) => ({
        id: member.id,
        name: member.user.name,
        email: member.user.email,
      }))}
    />
  );
}
