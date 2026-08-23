import { WorkflowPanel } from "@/components/app/workflow-panel";
import { getWorkflowStatuses } from "@/lib/actions/workflow-statuses";
import { requireProjectWorkspace } from "@/lib/project-workspace";

export default async function ProjectWorkflowPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
}) {
  const { orgSlug, projectKey } = await params;
  // Reading the flow only needs backlog:view — the columns are visible to
  // anyone who can see the board. Editing them needs role:manage, checked
  // again in every action.
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "backlog:view",
  );

  const statuses = await getWorkflowStatuses({
    organizationId: workspace.organization.id,
    projectId: workspace.project.id,
  });

  return (
    <WorkflowPanel
      project={{
        id: workspace.project.id,
        key: workspace.project.key,
        name: workspace.project.name,
      }}
      basePath={workspace.basePath}
      statuses={statuses}
      canManage={workspace.can("role:manage")}
    />
  );
}
