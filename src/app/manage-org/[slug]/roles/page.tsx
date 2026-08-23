import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { ProjectRolesPanel } from "@/components/org/project-roles-panel";
import { listOrgProjectRoles } from "@/lib/actions/project-roles";
import { auth } from "@/lib/auth";

export default async function OrgRolesPage({
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
    notFound();
  }

  const roles = await listOrgProjectRoles(organization.id);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Project roles"
        description="Define what people can do on projects. These roles are available on every project."
      />
      <ProjectRolesPanel
        organizationId={organization.id}
        canManage
        initialRoles={roles}
      />
    </PageContainer>
  );
}
