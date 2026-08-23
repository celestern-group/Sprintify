import { OrgAuditLogPanel } from "@/components/org/audit-log-panel";

export default async function OrgAuditPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OrgAuditLogPanel slug={slug} />;
}
