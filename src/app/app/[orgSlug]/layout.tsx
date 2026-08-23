import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { OrgProvider } from "@/components/dashboard/org-context";
import { PreferenceScopeProvider } from "@/components/preferences/preference-scope";
import { getBellData } from "@/lib/actions/notifications";
import { resolveActiveProject } from "@/lib/active-project";
import { auth } from "@/lib/auth";
import { listAccessibleProjects } from "@/lib/project-access";
import { canManageOrg, hasAdminRole } from "@/lib/roles";
import { getUserOrganizations, requireAuth } from "@/lib/session";

export default async function AppOrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);
  const org = organizations.find((candidate) => candidate.slug === orgSlug);

  if (!org) {
    redirect("/app");
  }

  if (session.session.activeOrganizationId !== org.id) {
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationSlug: orgSlug },
    });
  }

  const projects = await listAccessibleProjects(org.id, session.user.id);
  const bellData = await getBellData({ organizationId: org.id });
  // The org-level sections (/availability) render as a project without naming
  // one in the URL, so the chrome resolves the same session pointer their
  // pages do.
  const activeProject = await resolveActiveProject({
    organizationId: org.id,
    userId: session.user.id,
    activeProjectId: session.session.activeProjectId,
  });

  return (
    <AppShell
      organizations={organizations}
      activeSlug={org.slug}
      projects={projects}
      activeProjectKey={activeProject?.key}
      canManageOrg={canManageOrg(org.role)}
      canCreateOrg
      isAdmin={hasAdminRole(session.user.role)}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      impersonatedBy={session.session.impersonatedBy}
      bell={{ organizationId: org.id, orgSlug: org.slug, data: bellData }}
    >
      <PreferenceScopeProvider scope={`u:${session.user.id}:org:${org.id}`}>
        <OrgProvider organization={org}>{children}</OrgProvider>
      </PreferenceScopeProvider>
    </AppShell>
  );
}
