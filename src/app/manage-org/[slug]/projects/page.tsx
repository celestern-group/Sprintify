import { headers } from "next/headers";
import { ProjectsPanel } from "@/components/org/projects-panel";
import { getProjects } from "@/lib/actions/projects";
import { auth } from "@/lib/auth";

export default async function OrgProjectsPage({
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

  const projects = await getProjects(organization.id);

  return (
    <ProjectsPanel
      organizationId={organization.id}
      organizationName={organization.name}
      organizationSlug={slug}
      initialProjects={projects}
    />
  );
}
