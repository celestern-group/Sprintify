import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { WorkItemFieldsPanel } from "@/components/org/work-item-fields-panel";
import { WorkItemTypesPanel } from "@/components/org/work-item-types-panel";
import { db } from "@/db";
import { organization } from "@/db/schema";
import { getWorkItemFields } from "@/lib/actions/work-item-fields";
import { getWorkItemTypes } from "@/lib/actions/work-item-types";
import { requireAdmin } from "@/lib/session";

/**
 * The platform admin's door into one organization's work item vocabulary.
 *
 * Deliberately the SAME panels as /manage-org/[slug]/work-items rather than an
 * admin-only variant: two implementations of "edit a work item type" would
 * drift, and the actions already accept a platform admin (see requireFieldAdmin
 * / requireTypeAdmin) precisely so this page needs no parallel API.
 */
export default async function AdminOrganizationWorkItemsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();

  const [org] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  if (!org) notFound();

  const [types, fields] = await Promise.all([
    getWorkItemTypes(org.id),
    getWorkItemFields(org.id),
  ]);

  return (
    <WorkItemTypesPanel
      organizationId={org.id}
      organizationName={org.name}
      types={types}
      backHref={`/admin/organizations/${org.id}`}
    >
      <WorkItemFieldsPanel
        organizationId={org.id}
        fields={fields}
        types={types}
      />
    </WorkItemTypesPanel>
  );
}
