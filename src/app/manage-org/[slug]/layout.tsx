import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgProvider } from "@/components/dashboard/org-context";
import { ManageShell } from "@/components/manage/manage-shell";
import { PreferenceScopeProvider } from "@/components/preferences/preference-scope";
import { getBellData } from "@/lib/actions/notifications";
import { auth } from "@/lib/auth";
import { canManageOrg, hasAdminRole } from "@/lib/roles";
import { getUserOrganizations, requireAuth } from "@/lib/session";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);
  const org = organizations.find((candidate) => candidate.slug === slug);

  if (!org || !canManageOrg(org.role)) {
    redirect("/app");
  }

  await auth.api.setActiveOrganization({
    headers: await headers(),
    body: { organizationSlug: slug },
  });

  const bellData = await getBellData({ organizationId: org.id });

  return (
    <ManageShell
      organizations={organizations}
      activeSlug={org.slug}
      canManageOrg
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
    </ManageShell>
  );
}
