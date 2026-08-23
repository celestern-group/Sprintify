import { headers } from "next/headers";
import { AiSettingsPanel } from "@/components/org/ai-settings-panel";
import { getOrganizationAiConfig } from "@/lib/actions/ai";
import { auth } from "@/lib/auth";

// A revoked platform grant has to show up immediately, so this page is never
// served from a cached render.
export const dynamic = "force-dynamic";

export default async function OrgAiPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const organization = await auth.api.getFullOrganization({
    headers: await headers(),
    query: { organizationSlug: slug },
  });

  if (!organization) {
    return null;
  }

  const view = await getOrganizationAiConfig(organization.id);

  return (
    <AiSettingsPanel
      organizationId={organization.id}
      organizationName={organization.name}
      view={view}
    />
  );
}
