import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/dashboard/onboarding-shell";
import { OnboardingWizard } from "@/components/dashboard/onboarding-wizard";
import { OrgPicker } from "@/components/dashboard/org-picker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { hasAdminRole } from "@/lib/roles";
import { getUserOrganizations, requireAuth } from "@/lib/session";

export default async function AppResolverPage() {
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);

  if (organizations.length === 1) {
    redirect(`/app/${organizations[0].slug}`);
  }

  if (organizations.length > 1) {
    const activeId = session.session.activeOrganizationId;
    const active = activeId
      ? organizations.find((org) => org.id === activeId)
      : undefined;

    if (active) {
      redirect(`/app/${active.slug}`);
    }

    return (
      <OnboardingShell>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
          <Card>
            <CardHeader>
              <CardTitle>Choose an organization</CardTitle>
              <CardDescription>
                Pick which organization to continue with.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OrgPicker organizations={organizations} />
            </CardContent>
          </Card>
        </div>
      </OnboardingShell>
    );
  }

  // Platform admins skip onboarding entirely and go straight to the admin
  // panel; creating orgs/projects is a normal-user flow.
  if (hasAdminRole(session.user.role)) {
    redirect("/admin");
  }

  const invitations = await auth.api.listUserInvitations({
    headers: await headers(),
  });
  const pending = invitations.filter((invite) => invite.status === "pending");

  return (
    <OnboardingShell>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
        {pending.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {pending.map((invite) => (
                <Link
                  key={invite.id}
                  href={`/accept-invitation/${invite.id}`}
                  className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
                >
                  Join {invite.organizationName}
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}
        <OnboardingWizard />
      </div>
    </OnboardingShell>
  );
}
