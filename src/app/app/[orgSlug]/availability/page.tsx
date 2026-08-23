import { and, eq, inArray, or } from "drizzle-orm";
import { headers } from "next/headers";
import { AvailabilityPanel } from "@/components/app/availability-panel";
import type { AvailabilityPerson } from "@/components/app/team-availability";
import { db } from "@/db";
import { member, user } from "@/db/schema";
import { getCalendars } from "@/lib/actions/holidays";
import { getCapacityProfile, listLeave } from "@/lib/actions/leave";
import { getProjectMembers } from "@/lib/actions/project-members";
import { requireActiveProjectWorkspace } from "@/lib/project-workspace";

/**
 * Availability is an organization-level page — your working pattern and leave
 * belong to you in the org, not to one project — so it lives at
 * /app/[orgSlug]/availability. It still renders inside the active project's
 * chrome, and the roster below it is that project's people, which is why it
 * resolves a workspace rather than just an organization.
 */
export default async function OrgAvailabilityPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  // TEMPORARY (remove once the refetch loop is diagnosed): tells apart a full
  // document load, a router refetch (rsc: "1"), and a prefetch.
  //
  // rsc/prefetch/next-url all null means the router is NOT involved — it is the
  // browser asking for a document. The fetch-metadata headers below say which
  // browser behaviour: `secPurpose: "prefetch;prerender"` (or purpose:
  // "prefetch") is the browser speculatively preloading a link it thinks you
  // will click — Edge/Chrome "preload pages for faster browsing" — and is not
  // triggered by our code. A bare `mode: "navigate"` with no sec-purpose is a
  // real navigation, i.e. something in the app is assigning window.location.
  if (process.env.NODE_ENV === "development") {
    const h = await headers();
    console.log("[availability]", {
      rsc: h.get("rsc"),
      prefetch: h.get("next-router-prefetch"),
      nextUrl: h.get("next-url"),
      referer: h.get("referer"),
      accept: h.get("accept")?.slice(0, 40),
      secPurpose: h.get("sec-purpose"),
      purpose: h.get("purpose"),
      mode: h.get("sec-fetch-mode"),
      dest: h.get("sec-fetch-dest"),
      site: h.get("sec-fetch-site"),
    });
  }

  // No permission beyond project:view: your own availability is yours to edit
  // wherever you are. capacity:view only adds the team roster below it.
  const workspace = await requireActiveProjectWorkspace(orgSlug);
  const organizationId = workspace.organization.id;

  const [profile, myLeave, calendars] = await Promise.all([
    getCapacityProfile({ organizationId }),
    listLeave({ organizationId, memberId: workspace.memberId }),
    getCalendars(organizationId),
  ]);

  const team = workspace.can("capacity:view")
    ? await loadProjectTeam(
        organizationId,
        workspace.project.id,
        workspace.memberId,
      )
    : null;

  return (
    <AvailabilityPanel
      organizationId={organizationId}
      memberId={workspace.memberId}
      projectKey={workspace.project.key}
      initialProfile={profile}
      initialLeave={myLeave}
      team={team}
      calendars={calendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        isDefault: calendar.isDefault,
      }))}
      defaultCalendarName={
        calendars.find((calendar) => calendar.isDefault)?.name ?? null
      }
    />
  );
}

/**
 * Leave is stored per organization, so the roster is the org's leave narrowed
 * to this project's people rather than a query of its own — one member set,
 * one leave read, filtered in memory.
 *
 * The roster is not only `projectMember`: an org owner/admin reaches a project
 * through org rights without ever holding a project role, so the person
 * reading this page (and their peers) would otherwise be missing from the
 * lanes below their own — a project with no explicit members looked deserted
 * even when everyone looking at it was away. They're included and labelled, so
 * "on this project" stays honest about how each person got there.
 */
async function loadProjectTeam(
  organizationId: string,
  projectId: string,
  callerMemberId: string,
) {
  const [projectPeople, implicitPeople, leave] = await Promise.all([
    getProjectMembers({ organizationId, projectId }),
    // The caller plus every org owner/admin: exactly the people who can open
    // this project without a projectMember row.
    db
      .select({
        id: member.id,
        role: member.role,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(member.organizationId, organizationId),
          or(
            inArray(member.role, ["owner", "admin"]),
            eq(member.id, callerMemberId),
          ),
        ),
      ),
    listLeave({ organizationId }),
  ]);

  // Ordered you → project members → org admins, and deduped in that order so
  // the strongest reason a person is here is the one that gets shown.
  const byId = new Map<string, AvailabilityPerson>();
  for (const row of implicitPeople) {
    if (row.id !== callerMemberId) continue;
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      email: row.email,
      kind: "you",
    });
  }
  for (const row of projectPeople) {
    if (byId.has(row.memberId)) continue;
    byId.set(row.memberId, {
      id: row.memberId,
      name: row.userName,
      email: row.userEmail,
      kind: "project",
    });
  }
  for (const row of implicitPeople) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      email: row.email,
      kind: "admin",
    });
  }

  const members = [...byId.values()];
  const memberIds = new Set(members.map((row) => row.id));
  return {
    members,
    projectMemberCount: projectPeople.length,
    leave: leave.filter((row) => memberIds.has(row.memberId)),
  };
}
