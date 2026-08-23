import { CreateOrganizationForm } from "@/components/dashboard/create-organization-form";
import { OnboardingShell } from "@/components/dashboard/onboarding-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function NewOrganizationPage() {
  return (
    <OnboardingShell>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>New organization</CardTitle>
            <CardDescription>
              Create another organization. You can switch between them anytime.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrganizationForm />
          </CardContent>
        </Card>
      </div>
    </OnboardingShell>
  );
}
