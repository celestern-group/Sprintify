import { OrganizationDetail } from "@/components/admin/organization-detail";

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrganizationDetail id={id} />;
}
