import { CadencePanel } from "@/components/app/cadence-panel";
import { getCalendars } from "@/lib/actions/holidays";
import { requireProjectWorkspace } from "@/lib/project-workspace";
import { commonTimezones } from "@/lib/timezones";

export default async function ProjectCadencePage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
}) {
  const { orgSlug, projectKey } = await params;
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "sprint:manage",
  );

  const calendars = await getCalendars(workspace.organization.id);

  return (
    <CadencePanel
      project={{
        id: workspace.project.id,
        key: workspace.project.key,
        capacityUnit: workspace.project.capacityUnit,
        sprintLengthDays: workspace.project.sprintLengthDays,
        defaultHoursPerDay: workspace.project.defaultHoursPerDay,
        workingWeekdays: workspace.project.workingWeekdays,
        timezone: workspace.project.timezone,
        holidayCalendarId: workspace.project.holidayCalendarId,
      }}
      basePath={workspace.basePath}
      calendars={calendars.map((row) => ({ id: row.id, name: row.name }))}
      defaultCalendarName={calendars.find((row) => row.isDefault)?.name ?? null}
      timezones={commonTimezones()}
    />
  );
}
