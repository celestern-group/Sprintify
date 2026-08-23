import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { ProjectTabs } from "@/components/org/project-tabs";
import { getProject } from "@/lib/actions/projects";
import { auth } from "@/lib/auth";

// Owns the org/project resolution and the page header so neither remounts when
// switching between the Members and Roles tabs.
export default async function ProjectDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  const project = await getProject({
    organizationId: organization.id,
    projectId,
  });
  if (!project) {
    notFound();
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-4">
        <PageHeader
          eyebrow="Project"
          title={project.name}
          description={project.description ?? undefined}
        />
        <ProjectTabs basePath={`/manage-org/${slug}/projects/${projectId}`} />
      </div>
      {children}
    </PageContainer>
  );
}
