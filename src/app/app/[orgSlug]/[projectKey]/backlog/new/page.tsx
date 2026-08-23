import { notFound } from "next/navigation";
import { ItemForm } from "@/components/app/backlog/item-form";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { WORK_ITEM_PRIORITIES } from "@/db/schema/work-items";
import { getBacklogData } from "@/lib/actions/work-items";
import { requireProjectWorkspace } from "@/lib/project-workspace";
import {
  describeReturnTo,
  orgReturnToPrefixes,
  RETURN_TO_PARAM,
  sanitizeReturnTo,
} from "@/lib/return-to";

/**
 * Creating an item is a page, not a dialog — the same form the detail route
 * uses, so a field can never be editable but not creatable.
 *
 * The search params are seeds, not state: "New item" from a board column can
 * hand over that column, and from a sprint section that sprint, without the
 * form knowing where it was opened from.
 */
export default async function NewWorkItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
  searchParams: Promise<{
    type?: string;
    status?: string;
    sprint?: string;
    summary?: string;
    parent?: string;
    assignee?: string;
    priority?: string;
    points?: string;
    label?: string | string[];
    [RETURN_TO_PARAM]?: string | string[];
  }>;
}) {
  const { orgSlug, projectKey } = await params;
  const resolvedSearchParams = await searchParams;
  const {
    type,
    status,
    sprint,
    summary,
    parent,
    assignee,
    priority,
    points,
    label,
  } = resolvedSearchParams;
  // The address bar is user-writable, so a priority that isn't one is dropped
  // rather than seeded into a select that can't render it.
  const seededPriority = WORK_ITEM_PRIORITIES.find((row) => row === priority);
  const seededLabels = (
    Array.isArray(label) ? label : label ? [label] : []
  ).filter((row) => row.trim().length > 0);
  // "New item" is offered from the board, a sprint section and the overview —
  // cancelling out of the form belongs back on whichever of those it was.
  const returnTo = sanitizeReturnTo(
    resolvedSearchParams[RETURN_TO_PARAM],
    orgReturnToPrefixes(orgSlug),
  );
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "backlog:view",
  );
  // The action re-checks this; the route gate is what keeps someone who can't
  // create items from staring at a form that will refuse them.
  if (!workspace.can("item:create")) notFound();

  const data = await getBacklogData({
    organizationId: workspace.organization.id,
    projectId: workspace.project.id,
  });

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow={workspace.project.key}
        title="New work item"
        description="It lands in the backlog unless you plan it into a sprint."
        backHref={returnTo ?? `${workspace.basePath}/backlog`}
        backLabel={
          returnTo
            ? describeReturnTo(returnTo, workspace.basePath)
            : "Back to backlog"
        }
      />
      <ItemForm
        mode="create"
        item={null}
        projectId={workspace.project.id}
        basePath={workspace.basePath}
        returnTo={returnTo}
        types={data.types}
        statuses={data.statuses}
        sprints={data.sprints}
        members={data.members}
        siblings={data.items.map((row) => ({
          id: row.id,
          key: row.key,
          summary: row.summary,
          typeId: row.typeId,
          parentId: row.parentId,
        }))}
        labelSuggestions={Array.from(
          new Set(data.items.flatMap((row) => row.labels)),
        ).sort((a, b) => a.localeCompare(b))}
        fields={data.fields}
        abilities={{
          create: workspace.can("item:create"),
          update: workspace.can("item:update"),
          delete: workspace.can("item:delete"),
          attach: workspace.can("attachment:create"),
        }}
        capacityUnit={workspace.project.capacityUnit}
        presets={{
          typeId: type,
          statusId: status,
          sprintId: sprint,
          summary: summary?.slice(0, 300),
          parentId: parent,
          assigneeMemberId: data.members.some(
            (row) => row.memberId === assignee,
          )
            ? assignee
            : undefined,
          priority: seededPriority,
          points,
          labels: seededLabels.length > 0 ? seededLabels : undefined,
        }}
      />
    </PageContainer>
  );
}
