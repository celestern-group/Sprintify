import { AppShell } from "@/components/app/app-shell";
import { PreferenceScopeProvider } from "@/components/preferences/preference-scope";
import { listAccessibleProjects } from "@/lib/project-access";
import { canManageOrg, hasAdminRole } from "@/lib/roles";
import { getUserOrganizations, requireAuth } from "@/lib/session";

export default async function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);
  const activeOrg = organizations.find(
    (org) => org.id === session.session.activeOrganizationId,
  );
  // The account pages render in the org chrome but live outside an org route,
  // so the switcher only has something to offer if this layout loads it — an
  // empty one ("No projects yet.") strands you on /profile.
  const projects = activeOrg
    ? await listAccessibleProjects(activeOrg.id, session.user.id)
    : [];

  return (
    <AppShell
      organizations={organizations}
      activeSlug={activeOrg?.slug}
      projects={projects}
      canManageOrg={activeOrg ? canManageOrg(activeOrg.role) : false}
      canCreateOrg
      isAdmin={hasAdminRole(session.user.role)}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      impersonatedBy={session.session.impersonatedBy}
    >
      <PreferenceScopeProvider scope={`u:${session.user.id}`}>
        {children}
      </PreferenceScopeProvider>
    </AppShell>
  );
}
