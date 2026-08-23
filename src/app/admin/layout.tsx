import { IconAlertOctagon } from "@tabler/icons-react";
import Link from "next/link";
import { AdminSetupWizard } from "@/components/admin/setup-wizard";
import { ManageShell } from "@/components/manage/manage-shell";
import { PreferenceScopeProvider } from "@/components/preferences/preference-scope";
import { getPlatformLockdown } from "@/lib/platform-lockdown";
import { canManageOrg } from "@/lib/roles";
import { getUserOrganizations, requireAdmin } from "@/lib/session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  const [organizations, lockdown] = await Promise.all([
    getUserOrganizations(session.user.id),
    getPlatformLockdown(),
  ]);
  const activeOrg = organizations.find(
    (org) => org.id === session.session.activeOrganizationId,
  );

  return (
    <ManageShell
      organizations={organizations}
      activeSlug={activeOrg?.slug}
      canManageOrg={activeOrg ? canManageOrg(activeOrg.role) : false}
      canCreateOrg
      isAdmin
      needsSetup={organizations.length === 0}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      impersonatedBy={session.session.impersonatedBy}
    >
      {lockdown.enabled ? (
        <div className="flex items-center gap-2 border-b border-danger-border bg-danger-tint px-4 py-2.5 text-sm font-semibold text-foreground sm:px-6">
          <IconAlertOctagon className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0">
            Platform lockdown is active — all new sign-ups and creation are
            frozen.
          </span>
          <Link
            href="/admin/platform"
            className="ml-auto shrink-0 underline underline-offset-4"
          >
            Manage
          </Link>
        </div>
      ) : null}
      <PreferenceScopeProvider scope={`u:${session.user.id}:admin`}>
        {children}
      </PreferenceScopeProvider>
      <AdminSetupWizard needsSetup={organizations.length === 0} />
    </ManageShell>
  );
}
