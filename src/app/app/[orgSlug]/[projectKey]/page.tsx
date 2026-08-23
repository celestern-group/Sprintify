import {
  IconArrowRight,
  IconBeach,
  IconCalendarEvent,
  IconCalendarStats,
  IconChartLine,
  IconChecks,
  IconClockHour4,
  IconLayoutKanban,
  IconPlus,
  IconProgress,
  IconRocket,
  IconSettings,
  IconStack2,
} from "@tabler/icons-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CapacityGauge } from "@/components/app/capacity-gauge";
import {
  BurnDownChart,
  FlowChart,
  StatusDonut,
} from "@/components/app/overview/overview-charts";
import {
  AttentionPanel,
  RecentItems,
  StatusLegend,
  WorkloadPanel,
} from "@/components/app/overview/overview-panels";
import { PageHeader } from "@/components/app/page-header";
import { SprintStateBadge } from "@/components/app/sprint-state-badge";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { StatCard } from "@/components/dashboard/ui/stat-card";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { getProjectOverview } from "@/lib/actions/project-overview";
import { getSprints } from "@/lib/actions/sprints";
import { formatIsoShort } from "@/lib/date-only";
import { normalizeProjectKey } from "@/lib/project-key";
import { requireProjectWorkspace } from "@/lib/project-workspace";
import { withReturnTo } from "@/lib/return-to";
import { canManageOrg } from "@/lib/roles";

/**
 * The project overview: one screen that answers "where does this project
 * stand" — how much work is open and moving, what shipped over the last two
 * months, who is carrying it, what needs a decision today, and how the active
 * sprint is doing against its capacity.
 *
 * Restrained tone (Aurora's default): solid violet, no count-up, no gradient
 * feature tile. Every panel degrades on permission rather than on data — a
 * caller without backlog:view still gets the sprint half, and vice versa.
 */
export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
}) {
  const { orgSlug, projectKey } = await params;
  const workspace = await requireProjectWorkspace(orgSlug, projectKey);

  // Keys are canonically uppercase; a lowercase link still resolves, but the
  // URL is normalised so the sidebar's active state matches the segment.
  if (normalizeProjectKey(projectKey) !== projectKey) {
    redirect(`/app/${orgSlug}/${workspace.project.key}`);
  }

  const canSeeSprints = workspace.can("sprint:view");
  const canSeeBacklog = workspace.can("backlog:view");

  const [sprints, overview] = await Promise.all([
    canSeeSprints
      ? getSprints({
          organizationId: workspace.organization.id,
          projectId: workspace.project.id,
        })
      : Promise.resolve([]),
    canSeeBacklog
      ? getProjectOverview({
          organizationId: workspace.organization.id,
          projectId: workspace.project.id,
        })
      : Promise.resolve(null),
  ]);

  const active = sprints.find((row) => row.state === "active");
  const upcoming = sprints.filter((row) => row.state === "planning");
  const unitLabel = workspace.project.capacityUnit === "points" ? "pts" : "h";
  const over = active ? active.committedPoints > active.plannedCapacity : false;

  const openCount = overview
    ? overview.byCategory.todo.count + overview.byCategory.in_progress.count
    : 0;
  const shippedDelta =
    overview && overview.completedPrev7 > 0
      ? Math.round(
          ((overview.completedLast7 - overview.completedPrev7) /
            overview.completedPrev7) *
            100,
        )
      : null;
  const sprintDoneShare =
    overview?.sprintScope && overview.sprintScope.items > 0
      ? Math.round(
          (overview.sprintScope.done / overview.sprintScope.items) * 100,
        )
      : 0;

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow={workspace.project.key}
        title={workspace.project.name}
        description={workspace.project.description ?? "No description yet."}
      >
        {canSeeBacklog ? (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`${workspace.basePath}/board`} />}
          >
            <IconLayoutKanban data-icon="inline-start" />
            Board
          </Button>
        ) : null}
        {workspace.can("item:create") ? (
          <Button
            nativeButton={false}
            render={
              <Link
                href={withReturnTo(
                  `${workspace.basePath}/backlog/new`,
                  workspace.basePath,
                )}
              />
            }
          >
            <IconPlus data-icon="inline-start" />
            New item
          </Button>
        ) : null}
      </PageHeader>

      {!canSeeSprints && !canSeeBacklog ? (
        <SectionCard title="Nothing here yet">
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="grid size-11 place-items-center rounded-md bg-secondary text-secondary-foreground">
              <IconRocket className="size-5" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your role on this project doesn&apos;t include the backlog or
              sprints. Ask a project admin if you think that&apos;s wrong.
            </p>
          </div>
        </SectionCard>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {overview ? (
              <>
                <StatCard
                  label="Open work"
                  value={openCount}
                  icon={IconStack2}
                  foot={`of ${overview.total} item${overview.total === 1 ? "" : "s"} in the project`}
                />
                <StatCard
                  label="In progress"
                  value={overview.byCategory.in_progress.count}
                  icon={IconProgress}
                  tone="blue"
                  foot={
                    overview.unassigned > 0
                      ? `${overview.unassigned} open, nobody assigned`
                      : "Everything open is assigned"
                  }
                />
                <StatCard
                  label="Shipped this week"
                  value={overview.completedLast7}
                  icon={IconChecks}
                  tone="success"
                  delta={
                    shippedDelta === null
                      ? undefined
                      : `${Math.abs(shippedDelta)}%`
                  }
                  deltaUp={(shippedDelta ?? 0) >= 0}
                  foot={`${overview.completedPrev7} the week before`}
                />
              </>
            ) : null}
            {canSeeSprints ? (
              <StatCard
                label={active ? "Committed" : "In planning"}
                value={
                  active
                    ? `${active.committedPoints}${unitLabel}`
                    : upcoming.length
                }
                icon={active ? IconCalendarStats : IconCalendarEvent}
                tone={over ? "amber" : "brand"}
                foot={
                  active
                    ? over
                      ? `Over ${active.plannedCapacity}${unitLabel} capacity`
                      : `${Math.round((active.plannedCapacity - active.committedPoints) * 100) / 100}${unitLabel} headroom`
                    : upcoming[0]
                      ? `Next starts ${formatIsoShort(upcoming[0].startDate)}`
                      : "Nothing queued"
                }
              />
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            {overview ? (
              <SectionCard
                title="Delivery flow"
                description="Items created and completed, by week."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`${workspace.basePath}/backlog`} />}
                  >
                    Backlog
                  </Button>
                }
              >
                <div className="flex flex-col gap-3">
                  <FlowChart data={overview.flow} />
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-0.5 w-4 rounded-full bg-chart-1"
                      />
                      Completed ·{" "}
                      <span className="font-semibold tabular-nums text-foreground">
                        {overview.flow.reduce(
                          (sum, point) => sum + point.completed,
                          0,
                        )}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-0.5 w-4 rounded-full border-t-2 border-dashed border-chart-2"
                      />
                      Created ·{" "}
                      <span className="font-semibold tabular-nums text-foreground">
                        {overview.flow.reduce(
                          (sum, point) => sum + point.created,
                          0,
                        )}
                      </span>
                    </span>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {canSeeSprints ? (
              active ? (
                <SectionCard
                  title="Active sprint"
                  description={active.goal ?? "No goal set."}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          href={`${workspace.basePath}/sprints/${active.id}`}
                        />
                      }
                    >
                      Open
                    </Button>
                  }
                >
                  <div className="flex flex-col gap-4">
                    <CapacityGauge
                      committed={active.committedPoints}
                      capacity={active.plannedCapacity}
                      unitLabel={unitLabel}
                    />
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="text-sm font-semibold">
                        {active.name}
                      </span>
                      <SprintStateBadge state={active.state} />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatIsoShort(active.startDate)} –{" "}
                        {formatIsoShort(active.endDate)}
                      </span>
                    </div>
                    {/* Committed-vs-capacity is the gauge above; this bar is
                        the other half of the question — how much of what was
                        committed is actually done. Both carry a text readout,
                        so the fill is never the only signal. */}
                    {overview?.sprintScope ? (
                      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                        <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                          <span className="font-semibold tabular-nums text-foreground">
                            {overview.sprintScope.done} of{" "}
                            {overview.sprintScope.items} items done
                          </span>
                          <span className="tabular-nums">
                            {sprintDoneShare}%
                          </span>
                        </div>
                        <span
                          aria-hidden
                          className="h-2 overflow-hidden rounded-full bg-muted"
                        >
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${sprintDoneShare}%` }}
                          />
                        </span>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-center">
                      <div className="flex flex-col">
                        <span className="text-lg font-extrabold tabular-nums">
                          {active.plannedCapacity}
                          {unitLabel}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                          Capacity
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-lg font-extrabold tabular-nums">
                          {active.memberCount}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                          On the sprint
                        </span>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              ) : (
                <SectionCard
                  title="No active sprint"
                  description={
                    upcoming.length > 0
                      ? `${upcoming.length} sprint${upcoming.length === 1 ? "" : "s"} in planning.`
                      : "Nothing planned yet."
                  }
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`${workspace.basePath}/sprints`} />}
                    >
                      Sprints
                    </Button>
                  }
                >
                  <p className="text-sm text-muted-foreground">
                    Start a sprint to see capacity, commitment and burn-down
                    here.
                  </p>
                </SectionCard>
              )
            ) : null}
          </div>

          {overview?.sprintScope && active ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <SectionCard
                title="Sprint burn-down"
                description={`Current scope for ${overview.sprintScope.name}. Remaining work is measured in ${unitLabel}.`}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={
                      <Link
                        href={`${workspace.basePath}/sprints/${active.id}`}
                      />
                    }
                  >
                    Sprint
                  </Button>
                }
              >
                <div className="flex flex-col gap-3">
                  <BurnDownChart
                    data={overview.sprintScope.burnDown}
                    unitLabel={unitLabel}
                  />
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-0.5 w-4 rounded-full bg-chart-1"
                      />
                      Remaining ·{" "}
                      <span className="font-semibold tabular-nums text-foreground">
                        {Math.max(
                          0,
                          overview.sprintScope.points -
                            overview.sprintScope.donePoints,
                        )}
                        {unitLabel}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-0.5 w-4 border-t-2 border-dashed border-chart-2"
                      />
                      Ideal pace ·{" "}
                      <span className="font-semibold tabular-nums text-foreground">
                        {Math.round(
                          (overview.sprintScope.burnDown.at(-1)?.ideal ?? 0) *
                            100,
                        ) / 100}
                        {unitLabel}
                      </span>
                    </span>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Effort"
                description="Capacity, commitment and recorded time for the current sprint."
              >
                <div className="grid grid-cols-2 gap-3">
                  <EffortMetric
                    icon={IconCalendarStats}
                    label="Capacity"
                    value={`${active.plannedCapacity}${unitLabel}`}
                  />
                  <EffortMetric
                    icon={IconChartLine}
                    label="Committed"
                    value={`${overview.sprintScope.points}${unitLabel}`}
                  />
                  <EffortMetric
                    icon={IconChecks}
                    label="Completed"
                    value={`${overview.sprintScope.donePoints}${unitLabel}`}
                  />
                  <EffortMetric
                    icon={IconClockHour4}
                    label="Logged"
                    value={`${overview.sprintScope.actualEfforts}h`}
                  />
                </div>
                <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">
                    {overview.sprintScope.done} of {overview.sprintScope.items}
                  </span>{" "}
                  items complete ·{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {Math.max(
                      0,
                      overview.sprintScope.points -
                        overview.sprintScope.donePoints,
                    )}
                    {unitLabel}
                  </span>{" "}
                  remaining
                </div>
              </SectionCard>
            </div>
          ) : null}

          {overview ? (
            overview.total === 0 ? (
              <SectionCard
                title="No work items yet"
                description="The overview fills in as soon as the backlog does."
              >
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <div className="grid size-11 place-items-center rounded-md bg-secondary text-secondary-foreground">
                    <IconStack2 className="size-5" />
                  </div>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Create the first item and this page starts showing flow,
                    workload and everything that needs attention.
                  </p>
                  {workspace.can("item:create") ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          href={withReturnTo(
                            `${workspace.basePath}/backlog/new`,
                            workspace.basePath,
                          )}
                        />
                      }
                    >
                      <IconPlus data-icon="inline-start" />
                      New item
                    </Button>
                  ) : null}
                </div>
              </SectionCard>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  <SectionCard
                    title="Work breakdown"
                    description="Every item in the project, by status."
                  >
                    <div className="flex flex-col gap-4">
                      <StatusDonut
                        slices={[
                          overview.byCategory.todo,
                          overview.byCategory.in_progress,
                          overview.byCategory.done,
                        ]}
                        centerLabel="Items"
                      />
                      <StatusLegend
                        rows={overview.statuses}
                        total={overview.total}
                      />
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Workload"
                    description="Open items per person."
                  >
                    <WorkloadPanel
                      rows={overview.workload}
                      overflow={overview.workloadOverflow}
                      unitLabel={unitLabel}
                    />
                  </SectionCard>

                  <SectionCard
                    title="Needs attention"
                    description="Open work with something missing or late."
                    className="lg:col-span-2 xl:col-span-1"
                  >
                    <AttentionPanel data={overview} />
                  </SectionCard>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                  <SectionCard
                    title="Recently updated"
                    description="What moved most recently."
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`${workspace.basePath}/backlog`} />}
                      >
                        View all
                      </Button>
                    }
                  >
                    <RecentItems
                      items={overview.recent}
                      basePath={workspace.basePath}
                    />
                  </SectionCard>

                  <div className="flex flex-col gap-4">
                    {canSeeSprints ? (
                      <SectionCard
                        title="Coming up"
                        description={
                          upcoming.length > 0
                            ? "Sprints already scheduled."
                            : "Nothing scheduled yet."
                        }
                      >
                        {upcoming.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Plan one from the sprints page and it shows up here.
                          </p>
                        ) : (
                          <ul className="flex flex-col divide-y divide-border">
                            {upcoming.slice(0, 4).map((row) => (
                              <li
                                key={row.id}
                                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                              >
                                <div className="flex min-w-0 flex-col">
                                  <Link
                                    href={`${workspace.basePath}/sprints/${row.id}`}
                                    className="truncate text-sm font-semibold hover:underline"
                                  >
                                    {row.name}
                                  </Link>
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {formatIsoShort(row.startDate)} –{" "}
                                    {formatIsoShort(row.endDate)}
                                  </span>
                                </div>
                                <span className="shrink-0 text-xs font-semibold tabular-nums">
                                  {row.plannedCapacity}
                                  {unitLabel}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </SectionCard>
                    ) : null}

                    <SetUpCard
                      basePath={workspace.basePath}
                      orgSlug={workspace.organization.slug}
                      canManageOrg={canManageOrg(workspace.organization.role)}
                    />
                  </div>
                </div>
              </>
            )
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <SectionCard
                title="Coming up"
                description={
                  upcoming.length > 0
                    ? "Sprints already scheduled."
                    : "Nothing scheduled yet."
                }
              >
                {upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Plan one from the sprints page and it shows up here.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {upcoming.slice(0, 5).map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                      >
                        <div className="flex min-w-0 flex-col">
                          <Link
                            href={`${workspace.basePath}/sprints/${row.id}`}
                            className="truncate text-sm font-semibold hover:underline"
                          >
                            {row.name}
                          </Link>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatIsoShort(row.startDate)} –{" "}
                            {formatIsoShort(row.endDate)}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {row.plannedCapacity}
                          {unitLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
              <SetUpCard
                basePath={workspace.basePath}
                orgSlug={workspace.organization.slug}
                canManageOrg={canManageOrg(workspace.organization.role)}
              />
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}

function EffortMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconCalendarStats;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md bg-chip p-3">
      <Icon className="mb-2 size-4 text-secondary-foreground" aria-hidden />
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

/** The three settings sprint capacity is derived from. */
function SetUpCard({
  basePath,
  orgSlug,
  canManageOrg,
}: {
  basePath: string;
  orgSlug: string;
  /** Working time now lives under manage-org — only worth linking if the
   * caller can actually get past that gate. */
  canManageOrg: boolean;
}) {
  const links = [
    {
      href: `${basePath}/availability`,
      icon: IconBeach,
      label: "Availability",
      hint: "Working pattern and time off",
    },
    ...(canManageOrg
      ? [
          {
            href: `/manage-org/${orgSlug}/working-time`,
            icon: IconCalendarEvent,
            label: "Working time",
            hint: "Holiday calendars",
          },
        ]
      : []),
    {
      href: `${basePath}/settings`,
      icon: IconSettings,
      label: "Cadence",
      hint: "Sprint length and defaults",
    },
  ];

  return (
    <SectionCard
      title="Set up"
      description="Everything sprint capacity is calculated from."
    >
      <ul className="flex flex-col gap-1">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-chip text-brand">
                <link.icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">
                  {link.label}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {link.hint}
                </span>
              </span>
              <IconArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
