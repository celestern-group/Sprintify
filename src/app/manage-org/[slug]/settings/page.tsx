import { headers } from "next/headers";
import { OrgSettingsPanel } from "@/components/org/org-settings-panel";
import { auth } from "@/lib/auth";
import { countOrganizationProjects } from "@/lib/organization-projects";

export default async function OrgSettingsPage({
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

  const projectCount = await countOrganizationProjects(organization.id);

  return (
    <OrgSettingsPanel
      organizationId={organization.id}
      initialName={organization.name}
      initialSlug={organization.slug}
      projectCount={projectCount}
    />
  );
}
