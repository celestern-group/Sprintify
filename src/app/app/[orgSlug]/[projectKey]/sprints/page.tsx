import { and, asc, eq, gte, lte } from "drizzle-orm";
import { SprintsPanel } from "@/components/app/sprints-panel";
import { db } from "@/db";
import { holiday, holidayCalendar } from "@/db/schema";
import { getNextSprintDefaults, getSprints } from "@/lib/actions/sprints";
import { requireProjectWorkspace } from "@/lib/project-workspace";

export default async function SprintsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
}) {
  const { orgSlug, projectKey } = await params;
  const workspace = await requireProjectWorkspace(
    orgSlug,
    projectKey,
    "sprint:view",
  );

  const [sprints, defaults] = await Promise.all([
    getSprints({
      organizationId: workspace.organization.id,
      projectId: workspace.project.id,
    }),
    getNextSprintDefaults({
      organizationId: workspace.organization.id,
      projectId: workspace.project.id,
    }),
  ]);

  // Holidays across the whole visible span, so the timeline can mark them
  // beyond the bounds of any single sprint.
  const holidays = await loadTimelineHolidays(
    workspace.organization.id,
    workspace.project.holidayCalendarId,
    sprints,
  );

  return (
    <SprintsPanel
      project={{
        id: workspace.project.id,
        name: workspace.project.name,
        key: workspace.project.key,
        capacityUnit: workspace.project.capacityUnit,
      }}
      basePath={workspace.basePath}
      sprints={sprints}
      holidays={holidays}
      memberNames={[]}
      canCreate={workspace.can("sprint:create")}
      canManage={workspace.can("sprint:manage")}
      defaults={{
        lastEndDate: defaults.lastEndDate,
        nextSequence: defaults.nextSequence,
        sprintLengthDays: defaults.sprintLengthDays,
      }}
    />
  );
}

async function loadTimelineHolidays(
  organizationId: string,
  projectCalendarId: string | null,
  sprints: { startDate: string; endDate: string }[],
) {
  if (sprints.length === 0) return [];

  let calendarId = projectCalendarId;
  if (!calendarId) {
    const [fallback] = await db
      .select({ id: holidayCalendar.id })
      .from(holidayCalendar)
      .where(
        and(
          eq(holidayCalendar.organizationId, organizationId),
          eq(holidayCalendar.isDefault, true),
        ),
      )
      .limit(1);
    calendarId = fallback?.id ?? null;
  }
  if (!calendarId) return [];

  const from = sprints.reduce(
    (min, row) => (row.startDate < min ? row.startDate : min),
    sprints[0].startDate,
  );
  const to = sprints.reduce(
    (max, row) => (row.endDate > max ? row.endDate : max),
    sprints[0].endDate,
  );

  return db
    .select({ date: holiday.date, name: holiday.name })
    .from(holiday)
    .where(
      and(
        eq(holiday.calendarId, calendarId),
        gte(holiday.date, from),
        lte(holiday.date, to),
      ),
    )
    .orderBy(asc(holiday.date));
}
