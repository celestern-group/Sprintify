import { OrgAiAccessPanel } from "@/components/admin/org-ai-access-panel";
import { PlatformAiPanel } from "@/components/admin/platform-ai-panel";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { getPlatformAiConfig } from "@/lib/actions/admin-ai";

// Provider credentials and per-org grants must never be served from a cached
// render — a revoked grant has to be visible immediately.
export const dynamic = "force-dynamic";

export default async function PlatformAiPage() {
  const view = await getPlatformAiConfig();

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Platform"
        title="AI configuration"
        description="Set the shared AI provider and models, and choose which organizations may use them."
      />
      <PlatformAiPanel view={view} />
      <OrgAiAccessPanel />
    </PageContainer>
  );
}
