import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/dashboard/onboarding-shell";
import { OrgPicker } from "@/components/dashboard/org-picker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserOrganizations, requireAuth } from "@/lib/session";

export default async function ManageOrgResolverPage() {
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);

  if (organizations.length === 0) {
    redirect("/app");
  }

  if (organizations.length === 1) {
    redirect(`/manage-org/${organizations[0].slug}`);
  }

  const activeId = session.session.activeOrganizationId;
  const active = activeId
    ? organizations.find((org) => org.id === activeId)
    : undefined;

  if (active) {
    redirect(`/manage-org/${active.slug}`);
  }

  return (
    <OnboardingShell>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Choose an organization</CardTitle>
            <CardDescription>
              Pick which organization to manage.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrgPicker organizations={organizations} basePath="/manage-org" />
          </CardContent>
        </Card>
      </div>
    </OnboardingShell>
  );
}
