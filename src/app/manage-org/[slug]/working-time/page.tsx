import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CalendarsPanel } from "@/components/org/calendars-panel";
import { getCalendars } from "@/lib/actions/holidays";
import { auth } from "@/lib/auth";
import { hasOrgPermission } from "@/lib/project-access";
import { commonTimezones } from "@/lib/timezones";

/**
 * Holiday calendars are organization rows shared by every project, so they
 * live on the org-admin surface. The layout above already gates this whole
 * tree on canManageOrg; canManage here narrows further to the org's own
 * holidayCalendar permission (owner/admin by default, but a custom role could
 * differ).
 */
export default async function OrgWorkingTimePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const organization = await auth.api.getFullOrganization({
    headers: await headers(),
    query: { organizationSlug: slug },
  });
  if (!organization) notFound();

  const [calendars, canManage] = await Promise.all([
    getCalendars(organization.id),
    hasOrgPermission(organization.id, { holidayCalendar: ["update"] }),
  ]);

  return (
    <CalendarsPanel
      organizationId={organization.id}
      initialCalendars={calendars}
      canManage={canManage}
      timezones={commonTimezones()}
    />
  );
}
