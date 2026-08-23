import { PlatformLockdownPanel } from "@/components/admin/platform-lockdown-panel";
import { SignupControlPanel } from "@/components/admin/signup-control-panel";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import {
  getPlatformLockdown,
  getSignupDisabled,
} from "@/lib/platform-lockdown";

// A kill-switch page must never serve a cached state.
export const dynamic = "force-dynamic";

export default async function AdminPlatformPage() {
  const [lockdown, signupDisabled] = await Promise.all([
    getPlatformLockdown(),
    getSignupDisabled(),
  ]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Platform"
        title="Controls"
        description="Platform-wide switches. Changes apply immediately to every organization."
      />

      <SignupControlPanel disabled={signupDisabled} />

      <PlatformLockdownPanel
        enabled={lockdown.enabled}
        message={lockdown.message}
        enabledAt={lockdown.enabledAt?.toISOString() ?? null}
      />
    </PageContainer>
  );
}
