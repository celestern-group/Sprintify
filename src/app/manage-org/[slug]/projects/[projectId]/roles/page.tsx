import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ProjectRolesPanel } from "@/components/org/project-roles-panel";
import { listProjectRoles } from "@/lib/actions/project-roles";
import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/roles";
import { getUserOrganizations, requireAuth } from "@/lib/session";

export default async function ProjectRolesPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const session = await requireAuth();
  const organization = await auth.api.getFullOrganization({
    headers: await headers(),
    query: { organizationSlug: slug },
  });

  if (!organization) {
    notFound();
  }

  const { catalog, local } = await listProjectRoles({
    organizationId: organization.id,
    projectId,
  });

  // Only gates the UI affordances — every write re-checks on the server, where
  // a project role granting `role:manage` also passes.
  const organizations = await getUserOrganizations(session.user.id);
  const membership = organizations.find((candidate) => candidate.slug === slug);
  const canManage = canManageOrg(membership?.role ?? "member");

  return (
    <ProjectRolesPanel
      organizationId={organization.id}
      projectId={projectId}
      canManage={canManage}
      initialRoles={local}
      initialCatalog={catalog}
    />
  );
}
