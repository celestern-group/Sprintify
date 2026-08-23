import { notFound } from "next/navigation";
import { SprintDetailPanel } from "@/components/app/sprint-detail-panel";
import { getSprintDetail } from "@/lib/actions/sprints";
import { requireProjectWorkspace } from "@/lib/project-workspace";

export default async function SprintDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string; sprintId: string }>;
}) {
  const { orgSlug, projectKey, sprintId } = await params;
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "sprint:view",
  );

  const sprint = await getSprintDetail({
    organizationId: workspace.organization.id,
    sprintId,
  });

  // A sprint id from another project in the same org would otherwise render
  // under this project's URL.
  if (sprint.projectId !== workspace.project.id) notFound();

  return (
    <SprintDetailPanel
      sprint={sprint}
      basePath={workspace.basePath}
      callerMemberId={workspace.memberId}
      canManageSprint={workspace.can("sprint:manage")}
      canManageCapacity={workspace.can("capacity:manage")}
    />
  );
}
