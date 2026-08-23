import { IdeaWorkspace } from "@/components/app/ideas/idea-workspace";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import {
  getIdeaDetail,
  getIdeaProjectMembers,
  getIdeaWorkItemTypes,
} from "@/lib/actions/ideas";
import { requireProjectWorkspace } from "@/lib/project-workspace";

export default async function IdeaDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string; ideaId: string }>;
}) {
  const { orgSlug, projectKey, ideaId } = await params;
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "backlog:view",
  );
  const canCreate = workspace.can("item:create");
  const canComment = workspace.can("comment:create");
  const canUpdate = workspace.can("item:update");
  const [idea, types, members] = await Promise.all([
    getIdeaDetail(workspace.project.id, ideaId),
    canCreate ? getIdeaWorkItemTypes(workspace.project.id) : [],
    canComment || canUpdate ? getIdeaProjectMembers(workspace.project.id) : [],
  ]);
  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow="Discovery"
        title="Idea workspace"
        description="Collaborate on the opportunity before committing it to delivery."
        backHref={`${workspace.basePath}/ideas`}
        backLabel="All ideas"
      />
      <IdeaWorkspace
        idea={idea}
        projectId={workspace.project.id}
        types={types}
        members={members}
        canCreate={canCreate}
        canComment={canComment}
        canUpdate={canUpdate}
      />
    </PageContainer>
  );
}
