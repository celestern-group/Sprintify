import { IdeaManager } from "@/components/app/ideas/idea-manager";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { getIdeas, getIdeaWorkItemTypes } from "@/lib/actions/ideas";
import { requireProjectWorkspace } from "@/lib/project-workspace";

export default async function IdeasPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
}) {
  const { orgSlug, projectKey } = await params;
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "backlog:view",
  );
  const canCreate = workspace.can("item:create");
  const canUpdate = workspace.can("item:update");
  const [ideas, types] = await Promise.all([
    getIdeas(workspace.project.id),
    canCreate ? getIdeaWorkItemTypes(workspace.project.id) : [],
  ]);
  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow="Discovery"
        title="Idea manager"
        description="Share opportunities, evaluate them together, and turn the strongest ideas into work."
      />
      <IdeaManager
        projectId={workspace.project.id}
        basePath={workspace.basePath}
        projectKey={workspace.project.key}
        ideas={ideas}
        types={types}
        canCreate={canCreate}
        canUpdate={canUpdate}
      />
    </PageContainer>
  );
}
