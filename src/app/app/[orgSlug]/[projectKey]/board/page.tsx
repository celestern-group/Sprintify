import { BacklogPanel } from "@/components/app/backlog/backlog-panel";
import { getBacklogData } from "@/lib/actions/work-items";
import { requireProjectWorkspace } from "@/lib/project-workspace";

/**
 * The dedicated board page: the same dataset and drag behaviour as the
 * backlog's board tab, pinned to the board view with its own URL so the daily
 * surface is one click (and one bookmark) away. The backlog route keeps its
 * `?view=board` tab.
 */
export default async function BoardPage({
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

  const data = await getBacklogData({
    organizationId: workspace.organization.id,
    projectId: workspace.project.id,
  });

  return (
    <BacklogPanel
      project={{
        id: workspace.project.id,
        key: workspace.project.key,
        name: workspace.project.name,
        capacityUnit: workspace.project.capacityUnit,
      }}
      basePath={workspace.basePath}
      view="board"
      page="board"
      data={data}
      abilities={{
        create: workspace.can("item:create"),
        update: workspace.can("item:update"),
        delete: workspace.can("item:delete"),
        assign: workspace.can("item:assign"),
        prioritize: workspace.can("backlog:prioritize"),
      }}
    />
  );
}
