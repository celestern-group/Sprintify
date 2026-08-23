import { BacklogPanel } from "@/components/app/backlog/backlog-panel";
import { getBacklogData } from "@/lib/actions/work-items";
import { requireProjectWorkspace } from "@/lib/project-workspace";
import { type BacklogView, isBacklogView } from "@/lib/work-items";

export default async function BacklogPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { orgSlug, projectKey } = await params;
  const { view } = await searchParams;
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "backlog:view",
  );

  const data = await getBacklogData({
    organizationId: workspace.organization.id,
    projectId: workspace.project.id,
  });

  // An unknown ?view= falls back rather than 404s — the view is a preference,
  // and a stale bookmark shouldn't cost someone the page.
  const active: BacklogView = isBacklogView(view) ? view : "backlog";

  return (
    <BacklogPanel
      project={{
        id: workspace.project.id,
        key: workspace.project.key,
        name: workspace.project.name,
        capacityUnit: workspace.project.capacityUnit,
      }}
      basePath={workspace.basePath}
      view={active}
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
