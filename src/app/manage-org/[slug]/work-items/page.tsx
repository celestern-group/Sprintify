import { headers } from "next/headers";
import { WorkItemFieldsPanel } from "@/components/org/work-item-fields-panel";
import { WorkItemTypesPanel } from "@/components/org/work-item-types-panel";
import { getWorkItemFields } from "@/lib/actions/work-item-fields";
import { getWorkItemTypes } from "@/lib/actions/work-item-types";
import { auth } from "@/lib/auth";

export default async function OrgWorkItemTypesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const organization = await auth.api.getFullOrganization({
    headers: await headers(),
    query: { organizationSlug: slug },
  });

  if (!organization) return null;

  const [types, fields] = await Promise.all([
    getWorkItemTypes(organization.id),
    getWorkItemFields(organization.id),
  ]);

  return (
    <WorkItemTypesPanel
      organizationId={organization.id}
      organizationName={organization.name}
      types={types}
    >
      <WorkItemFieldsPanel
        organizationId={organization.id}
        fields={fields}
        types={types}
      />
    </WorkItemTypesPanel>
  );
}
