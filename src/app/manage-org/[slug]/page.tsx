import { headers } from "next/headers";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import type { ActivityPoint } from "@/components/dashboard/mock-data";
import { getProjects } from "@/lib/actions/projects";
import { getTeams } from "@/lib/actions/teams";
import { auth } from "@/lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// Build a real 8-week member-growth series from join dates: cumulative total
// members (`active`) and new joins per week (`joined`). There's no activity
// telemetry yet, so member growth is the honest signal we have.
function buildActivity(joinDates: Date[], now: number): ActivityPoint[] {
  const weeks = 8;
  const points: ActivityPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const bucketEnd = now - i * WEEK_MS;
    const bucketStart = bucketEnd - WEEK_MS;
    const joined = joinDates.filter(
      (d) => d.getTime() > bucketStart && d.getTime() <= bucketEnd,
    ).length;
    const active = joinDates.filter((d) => d.getTime() <= bucketEnd).length;
    points.push({
      label: new Date(bucketEnd).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      active,
      joined,
    });
  }
  return points;
}

function toUsage(label: string, used: number, unit: string) {
  return { label, detail: `${used} ${unit}`, pct: 0 };
}

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hdrs = await headers();
  const [organization, session] = await Promise.all([
    auth.api.getFullOrganization({
      headers: hdrs,
      query: { organizationSlug: slug },
    }),
    auth.api.getSession({ headers: hdrs }),
  ]);

  if (!organization) {
    return null;
  }

  const [projects, teams] = await Promise.all([
    getProjects(organization.id),
    getTeams(organization.id),
  ]);

  const members = organization.members ?? [];
  const pending = (organization.invitations ?? []).filter(
    (invite) => invite.status === "pending",
  ).length;

  const now = Date.now();
  const joinDates = members.map(
    (m) => new Date((m as { createdAt: string | Date }).createdAt),
  );
  const newMembers30d = joinDates.filter(
    (d) => now - d.getTime() <= 30 * DAY_MS,
  ).length;

  const roster = members.slice(0, 5).map((member) => ({
    name: member.user?.name || member.user?.email || "Member",
    email: member.user?.email ?? "",
    role: member.role ?? "member",
  }));

  const firstName = (session?.user?.name ?? "there").split(" ")[0];

  return (
    <DashboardClient
      orgName={organization.name}
      userName={firstName}
      members={members.length}
      pending={pending}
      projects={projects.length}
      membersDelta={newMembers30d > 0 ? `+${newMembers30d}` : undefined}
      membersFoot="in this workspace"
      projectsFoot="in this workspace"
      usage={[
        toUsage("Members", members.length, "members"),
        toUsage("Projects", projects.length, "projects"),
        toUsage("Teams", teams.length, "teams"),
      ]}
      activity={buildActivity(joinDates, now)}
      roster={roster}
    />
  );
}
