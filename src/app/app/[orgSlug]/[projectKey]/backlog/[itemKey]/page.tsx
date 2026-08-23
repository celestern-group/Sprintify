import { notFound } from "next/navigation";
import { ItemActivity } from "@/components/app/backlog/item-activity";
import { ItemForm } from "@/components/app/backlog/item-form";
import { ItemHistory } from "@/components/app/backlog/item-history";
import { ItemMeta } from "@/components/app/backlog/item-meta";
import { ItemRelations } from "@/components/app/backlog/item-relations";
import { WorkItemTypeIcon } from "@/components/app/backlog/work-item-visuals";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { getWorkItemCommentThread } from "@/lib/actions/work-item-comments";
import { getWorkItemDetail } from "@/lib/actions/work-items";
import { requireProjectWorkspace } from "@/lib/project-workspace";
import {
  describeReturnTo,
  orgReturnToPrefixes,
  RETURN_TO_PARAM,
  sanitizeReturnTo,
} from "@/lib/return-to";

/**
 * One work item, at its own URL: /app/[org]/[project]/backlog/PROJ-123.
 *
 * The key in the URL is the human reference people already paste into chat, so
 * the address bar and the card show the same string. Only its NUMBER is
 * trusted — the project half is re-derived from the route, so PROJ-1 can't be
 * used to read OTHER-1.
 */
export default async function WorkItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectKey: string; itemKey: string }>;
  searchParams: Promise<{ [RETURN_TO_PARAM]?: string | string[] }>;
}) {
  const { orgSlug, projectKey, itemKey } = await params;
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "backlog:view",
  );

  // Where the reader came from, if the link that brought them here said so —
  // the board they were scanning, the sprint they were planning, the overview
  // they were reading. Re-validated here rather than trusted: the value is in
  // the address bar, so it is user input like any other.
  const returnTo = sanitizeReturnTo(
    (await searchParams)[RETURN_TO_PARAM],
    orgReturnToPrefixes(orgSlug),
  );

  const number = parseItemNumber(itemKey);
  if (number === null) notFound();

  const detail = await getWorkItemDetail({
    organizationId: workspace.organization.id,
    projectId: workspace.project.id,
    number,
  });
  if (!detail) notFound();

  // Fetched here rather than inside the client component so the thread is in
  // the first paint — the live stream only has to carry what happens NEXT.
  const thread = await getWorkItemCommentThread({ workItemId: detail.item.id });

  const type = detail.types.find((row) => row.id === detail.item.typeId);

  return (
    <PageContainer width="full">
      {/* The type tile and the key lead; the SUMMARY is the heading, because
          that is what a person reading the page is here for — the key stays on
          the eyebrow line where it is still the thing you copy into chat. */}
      <PageHeader
        eyebrow={`${type?.name ?? "Item"} · ${detail.item.key}`}
        title={detail.item.summary}
        backHref={returnTo ?? `${workspace.basePath}/backlog`}
        backLabel={
          returnTo
            ? describeReturnTo(returnTo, workspace.basePath)
            : "Back to backlog"
        }
        icon={
          type ? (
            <WorkItemTypeIcon
              type={type}
              className="size-10 rounded-[11px] [&>svg]:size-6"
            />
          ) : null
        }
      />

      <ItemMeta
        item={detail.item}
        estimate={detail.estimate}
        statuses={detail.statuses}
        sprints={detail.sprints}
        reporterName={detail.reporterName}
        basePath={workspace.basePath}
        projectId={workspace.project.id}
        capacityUnit={workspace.project.capacityUnit}
      />

      <ItemForm
        mode="edit"
        item={detail.item}
        projectId={workspace.project.id}
        basePath={workspace.basePath}
        returnTo={returnTo}
        types={detail.types}
        statuses={detail.statuses}
        sprints={detail.sprints}
        members={detail.members}
        siblings={detail.siblings}
        labelSuggestions={detail.projectLabels}
        fields={detail.fields}
        abilities={{
          create: workspace.can("item:create"),
          update: workspace.can("item:update"),
          delete: workspace.can("item:delete"),
          attach: workspace.can("attachment:create"),
        }}
        capacityUnit={workspace.project.capacityUnit}
        rolledEstimate={
          detail.estimate.source === "rollup" ? detail.estimate.value : null
        }
        relations={
          <ItemRelations
            itemId={detail.item.id}
            itemTypeId={detail.item.typeId}
            parent={detail.parent}
            childItems={detail.children}
            relatedItems={detail.relatedItems}
            candidates={detail.siblings}
            types={detail.types}
            statuses={detail.statuses}
            fields={detail.fields}
            basePath={workspace.basePath}
            projectId={workspace.project.id}
            abilities={{
              create: workspace.can("item:create"),
              update: workspace.can("item:update"),
            }}
          />
        }
        activity={
          <ItemActivity
            attachments={detail.attachments}
            workItemId={detail.item.id}
            thread={thread}
            members={detail.members}
            history={
              <ItemHistory
                entries={detail.history}
                statuses={detail.statuses}
                types={detail.types}
                sprints={detail.sprints}
                members={detail.members}
                siblings={detail.siblings}
                capacityUnit={workspace.project.capacityUnit}
              />
            }
          />
        }
      />
    </PageContainer>
  );
}

/**
 * "PROJ-123" → 123, and "123" → 123 so a bare number still resolves. Anything
 * else is a 404 rather than a coerced 0 — NaN reaching the query would read as
 * "no such item" anyway, but much later and less clearly.
 */
function parseItemNumber(itemKey: string): number | null {
  const tail = decodeURIComponent(itemKey).split("-").pop() ?? "";
  if (!/^\d+$/.test(tail)) return null;
  const parsed = Number.parseInt(tail, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
