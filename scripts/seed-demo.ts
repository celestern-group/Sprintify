/**
 * Demo data seeder — DEVELOPMENT ONLY.
 *
 * Builds one fully-populated organization (people, teams, calendars, leave,
 * projects, sprints with capacity, a work-item tree, comments, reactions,
 * notifications and an audit trail) so every screen in the app has something
 * real to render without clicking through the product for an hour.
 *
 *   pnpm db:seed:demo                 # create it
 *   pnpm db:seed:demo --reset         # delete and rebuild it
 *   pnpm db:seed:demo --owner=me@x.io # add this account as owner instead of
 *                                     # SEED_ADMIN_EMAIL (the default)
 *
 * Deliberate choices:
 *  - Users are written directly (user + credential account row hashed through
 *    Better Auth's own hasher) rather than through auth.api.signUpEmail, so
 *    seeding never fires eight verification emails.
 *  - The organization is inserted directly and then handed to the same
 *    seedOrganization* helpers the afterCreateOrganization hook calls, which
 *    is exactly the "born outside the hook" path they exist for.
 *  - Randomness is a fixed-seed PRNG: two runs produce identical data, so a
 *    screenshot or a bug report stays reproducible.
 *  - Embeddings are NOT generated (scheduleEmbedding needs a request scope).
 *    Run `pnpm embeddings:backfill` afterwards if you need semantic search.
 */

import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import type { WorkItemPriority, WorkItemValueLevel } from "@/db/schema";
import {
  auditLog,
  holiday,
  holidayCalendar,
  member,
  memberCapacityProfile,
  memberLeave,
  notification,
  organization,
  project,
  projectMember,
  projectRole,
  sprint,
  team,
  teamMember,
  user,
  account as userAccount,
  workflowStatus,
  workItem,
  workItemComment,
  workItemCommentReaction,
  workItemField,
  workItemFieldValue,
  workItemType,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { seedOrganizationDefaultCalendar } from "@/lib/calendar-seed";
import { sprintEndFrom } from "@/lib/capacity";
import { seedSprintCapacities } from "@/lib/capacity-sync";
import { addDaysIso, type IsoDate, todayIso } from "@/lib/date-only";
import { seedOrganizationProjectRoles } from "@/lib/project-role-seed";
import { between, INITIAL_RANK } from "@/lib/rank";
import {
  seedOrganizationWorkItemTypes,
  seedProjectWorkflowStatuses,
} from "@/lib/work-item-seed";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1)$/i;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) =>
  args
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");

function assertDevelopment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run: NODE_ENV is production. Demo data is dev-only.",
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const { hostname } = new URL(url);
  if (!LOCAL_HOST_PATTERN.test(hostname) && !flag("allow-remote")) {
    throw new Error(
      `Refusing to run: DATABASE_URL host "${hostname}" doesn't look like a local database. ` +
        "Pass --allow-remote if this is genuinely your dev database.",
    );
  }
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260807);
const int = (min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
const pick = <T>(values: readonly T[]): T => values[int(0, values.length - 1)];
const chance = (probability: number) => random() < probability;

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

const DEMO_EMAIL_DOMAIN = "demo.sprintify.test";
const DEMO_PASSWORD = "Demo1234!";

type PersonKey =
  | "amara"
  | "daniel"
  | "priya"
  | "tomas"
  | "lena"
  | "kwame"
  | "sofia"
  | "ravi";

const PEOPLE: {
  key: PersonKey;
  name: string;
  email: string;
  orgRole: "owner" | "admin" | "member";
  hoursPerDay: number;
  workingWeekdays: number[];
}[] = [
  {
    key: "amara",
    name: "Amara Osei",
    email: `amara.osei@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "owner",
    hoursPerDay: 8,
    workingWeekdays: [1, 2, 3, 4, 5],
  },
  {
    key: "daniel",
    name: "Daniel Reyes",
    email: `daniel.reyes@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "admin",
    hoursPerDay: 8,
    workingWeekdays: [1, 2, 3, 4, 5],
  },
  {
    key: "priya",
    name: "Priya Nair",
    email: `priya.nair@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "member",
    hoursPerDay: 8,
    workingWeekdays: [1, 2, 3, 4, 5],
  },
  {
    key: "tomas",
    name: "Tomas Novak",
    email: `tomas.novak@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "member",
    hoursPerDay: 6,
    workingWeekdays: [1, 2, 3, 4],
  },
  {
    key: "lena",
    name: "Lena Fischer",
    email: `lena.fischer@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "member",
    hoursPerDay: 8,
    workingWeekdays: [1, 2, 3, 4, 5],
  },
  {
    key: "kwame",
    name: "Kwame Boateng",
    email: `kwame.boateng@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "member",
    hoursPerDay: 8,
    workingWeekdays: [1, 2, 3, 4, 5],
  },
  {
    key: "sofia",
    name: "Sofia Marino",
    email: `sofia.marino@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "member",
    hoursPerDay: 8,
    workingWeekdays: [1, 2, 3, 4, 5],
  },
  {
    key: "ravi",
    name: "Ravi Chandran",
    email: `ravi.chandran@${DEMO_EMAIL_DOMAIN}`,
    orgRole: "member",
    hoursPerDay: 4,
    workingWeekdays: [2, 3, 4],
  },
];

const TEAMS: { name: string; description: string; members: PersonKey[] }[] = [
  {
    name: "Platform",
    description: "Owns the web platform, billing and the shared service layer.",
    members: ["daniel", "priya", "tomas"],
  },
  {
    name: "Mobile",
    description: "Ships the Orbit iOS and Android clients.",
    members: ["daniel", "lena", "kwame"],
  },
  {
    name: "Data",
    description: "Ingestion, warehouse modelling and the reporting API.",
    members: ["amara", "sofia", "ravi"],
  },
];

// ---------------------------------------------------------------------------
// The backlog content
// ---------------------------------------------------------------------------

type LeafSeed = {
  type: "story" | "task" | "bug";
  summary: string;
  /** Rough size in the project's capacity unit; null leaves it unestimated. */
  size?: number | null;
};

type FeatureSeed = { summary: string; children: LeafSeed[] };
type EpicSeed = { summary: string; features: FeatureSeed[] };

type ProjectSeed = {
  key: string;
  name: string;
  description: string;
  capacityUnit: "hours" | "points";
  members: { person: PersonKey; roleKey: string }[];
  epics: EpicSeed[];
};

const PROJECTS: ProjectSeed[] = [
  {
    key: "APOLLO",
    name: "Apollo Web Platform",
    description:
      "The customer-facing web application: onboarding, billing and the account surface.",
    capacityUnit: "hours",
    members: [
      { person: "amara", roleKey: "product_owner" },
      { person: "daniel", roleKey: "scrum_master" },
      { person: "priya", roleKey: "developer" },
      { person: "tomas", roleKey: "developer" },
      { person: "ravi", roleKey: "viewer" },
    ],
    epics: [
      {
        summary: "Customer onboarding overhaul",
        features: [
          {
            summary: "Self-serve signup flow",
            children: [
              {
                type: "story",
                summary: "Sign up with email and password",
                size: 8,
              },
              {
                type: "story",
                summary: "Verify email before the first sign-in",
                size: 5,
              },
              {
                type: "task",
                summary: "Emit signup funnel analytics events",
                size: 3,
              },
              {
                type: "bug",
                summary: "Signup submits twice on a slow connection",
                size: 3,
              },
            ],
          },
          {
            summary: "Guided workspace setup",
            children: [
              { type: "story", summary: "Workspace creation wizard", size: 13 },
              {
                type: "story",
                summary: "Invite teammates during setup",
                size: 5,
              },
              {
                type: "task",
                summary: "Seed sample data for a new workspace",
                size: 5,
              },
            ],
          },
        ],
      },
      {
        summary: "Billing and plans",
        features: [
          {
            summary: "Plan selection",
            children: [
              { type: "story", summary: "Plan comparison page", size: 8 },
              {
                type: "story",
                summary: "Guardrails when downgrading below current usage",
                size: 8,
              },
              {
                type: "bug",
                summary: "Annual plan shows the monthly total at checkout",
                size: 2,
              },
            ],
          },
          {
            summary: "Invoices",
            children: [
              { type: "story", summary: "Download an invoice as PDF", size: 5 },
              {
                type: "task",
                summary: "Nightly invoice reconciliation job",
                size: 8,
              },
              {
                type: "task",
                summary: "Backfill invoice numbers for legacy accounts",
                size: null,
              },
            ],
          },
        ],
      },
      {
        summary: "Platform reliability",
        features: [
          {
            summary: "Observability",
            children: [
              {
                type: "task",
                summary: "Structured request logging with a trace id",
                size: 5,
              },
              {
                type: "story",
                summary: "Error budget dashboard for on-call",
                size: 8,
              },
              {
                type: "task",
                summary: "Alert when p95 latency regresses",
                size: 3,
              },
            ],
          },
          {
            summary: "Resilience",
            children: [
              {
                type: "bug",
                summary: "Session is lost for every user after a deploy",
                size: 5,
              },
              {
                type: "task",
                summary: "Retry transient database connect failures",
                size: 3,
              },
              {
                type: "story",
                summary: "Read-only mode during a database failover",
                size: 13,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "ORBIT",
    name: "Orbit Mobile",
    description:
      "The iOS and Android client: offline sync, push and field workflows.",
    capacityUnit: "points",
    members: [
      { person: "amara", roleKey: "product_owner" },
      { person: "daniel", roleKey: "scrum_master" },
      { person: "lena", roleKey: "developer" },
      { person: "kwame", roleKey: "developer" },
    ],
    epics: [
      {
        summary: "Offline-first sync",
        features: [
          {
            summary: "Local cache",
            children: [
              {
                type: "story",
                summary: "Read the backlog with no network",
                size: 8,
              },
              {
                type: "task",
                summary: "Encrypt the local cache at rest",
                size: 5,
              },
              {
                type: "bug",
                summary: "Cache is not cleared when switching account",
                size: 3,
              },
            ],
          },
          {
            summary: "Conflict resolution",
            children: [
              {
                type: "story",
                summary: "Queue edits made offline and replay them",
                size: 13,
              },
              {
                type: "story",
                summary: "Show a conflict banner when the server wins",
                size: 5,
              },
              { type: "task", summary: "Instrument sync failures", size: 2 },
            ],
          },
        ],
      },
      {
        summary: "Push notifications",
        features: [
          {
            summary: "Delivery",
            children: [
              {
                type: "story",
                summary: "Push when an item is assigned to me",
                size: 8,
              },
              {
                type: "task",
                summary: "Register and rotate device tokens",
                size: 5,
              },
              {
                type: "bug",
                summary: "Duplicate push after reinstalling the app",
                size: 3,
              },
            ],
          },
          {
            summary: "Preferences",
            children: [
              {
                type: "story",
                summary: "Mute notifications per project",
                size: 5,
              },
              {
                type: "story",
                summary: "Quiet hours in the device timezone",
                size: 8,
              },
            ],
          },
        ],
      },
      {
        summary: "App performance",
        features: [
          {
            summary: "Startup time",
            children: [
              {
                type: "task",
                summary: "Defer non-critical work off the launch path",
                size: 5,
              },
              {
                type: "bug",
                summary: "Cold start takes over four seconds on Android 12",
                size: 8,
              },
            ],
          },
          {
            summary: "List rendering",
            children: [
              {
                type: "story",
                summary: "Virtualise the board column list",
                size: 8,
              },
              {
                type: "task",
                summary: "Add a frame-drop regression test",
                size: 3,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "HELIX",
    name: "Helix Data Services",
    description:
      "Ingestion, warehouse modelling and the customer-facing reporting API.",
    capacityUnit: "hours",
    members: [
      { person: "amara", roleKey: "product_owner" },
      { person: "sofia", roleKey: "developer" },
      { person: "tomas", roleKey: "developer" },
      { person: "ravi", roleKey: "viewer" },
    ],
    epics: [
      {
        summary: "Ingestion pipeline",
        features: [
          {
            summary: "Source connectors",
            children: [
              {
                type: "story",
                summary: "Ingest events from the webhook gateway",
                size: 13,
              },
              {
                type: "story",
                summary: "Nightly pull from the billing database",
                size: 8,
              },
              {
                type: "bug",
                summary: "Connector drops events during a retry storm",
                size: 8,
              },
            ],
          },
          {
            summary: "Schema evolution",
            children: [
              { type: "task", summary: "Version the event envelope", size: 5 },
              {
                type: "story",
                summary: "Quarantine records that fail validation",
                size: 8,
              },
            ],
          },
        ],
      },
      {
        summary: "Data quality",
        features: [
          {
            summary: "Checks",
            children: [
              {
                type: "story",
                summary: "Freshness check per source table",
                size: 5,
              },
              { type: "task", summary: "Row-count anomaly detection", size: 8 },
              {
                type: "bug",
                summary: "Timezone drift in the daily rollup",
                size: 5,
              },
            ],
          },
          {
            summary: "Lineage",
            children: [
              {
                type: "story",
                summary: "Column-level lineage graph",
                size: 13,
              },
              {
                type: "task",
                summary: "Publish lineage to the catalog nightly",
                size: 5,
              },
            ],
          },
        ],
      },
      {
        summary: "Reporting API",
        features: [
          {
            summary: "Query surface",
            children: [
              {
                type: "story",
                summary: "Aggregate endpoint with cursor pagination",
                size: 13,
              },
              { type: "task", summary: "Per-tenant rate limiting", size: 5 },
              {
                type: "story",
                summary: "Signed export links that expire",
                size: 8,
              },
            ],
          },
          {
            summary: "Performance",
            children: [
              {
                type: "task",
                summary: "Materialise the heaviest three reports",
                size: 8,
              },
              {
                type: "bug",
                summary: "Report times out for tenants over 10M rows",
                size: null,
              },
            ],
          },
        ],
      },
    ],
  },
];

const LABELS = [
  "frontend",
  "backend",
  "infra",
  "security",
  "performance",
  "tech-debt",
  "customer-request",
  "a11y",
];

const HOLIDAY_TEMPLATES: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 5, day: 1, name: "Labour Day" },
  { month: 8, day: 15, name: "Company day" },
  { month: 12, day: 25, name: "Christmas Day" },
  { month: 12, day: 26, name: "Boxing Day" },
];

// ---------------------------------------------------------------------------
// Prose generators — enough body text that the item pages aren't empty.
// ---------------------------------------------------------------------------

function describeStory(summary: string, projectName: string) {
  return [
    `As a customer of ${projectName}, I want to ${summary[0].toLowerCase()}${summary.slice(1)} so that I can finish my work without leaving the product.`,
    "",
    "Scoped from the discovery notes in the last quarterly review. Anything not listed under the acceptance criteria is deliberately out of scope for this item.",
  ].join("\n");
}

function acceptanceCriteriaFor(summary: string) {
  return [
    "- [ ] The happy path works end to end with no console errors",
    "- [ ] Empty, loading and error states are implemented",
    `- [ ] "${summary}" is keyboard operable and passes the AA contrast check`,
    "- [ ] Covered by a test that fails without the change",
  ].join("\n");
}

function describeTask(summary: string) {
  return `${summary}. Internal work with no direct user-facing change; done when the behaviour is in place and observable in the dashboards.`;
}

function defectFieldsFor(summary: string) {
  return {
    stepsToReproduce: [
      "1. Sign in as a member of the demo organization",
      "2. Open the affected screen",
      "3. Repeat the action three times in a row",
    ].join("\n"),
    expectedResult:
      "The action completes once and the UI settles into a consistent state.",
    actualResult: `${summary}. Reproduced on the latest main build; not reproducible on the previous release.`,
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const today: IsoDate = todayIso();
const now = new Date();

function daysAgo(days: number) {
  return new Date(now.getTime() - days * 86_400_000);
}

async function resetDemoData(slug: string) {
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);

  if (existing) {
    // Every org-scoped table cascades off organization.id.
    await db.delete(organization).where(eq(organization.id, existing.id));
    console.log(`Deleted organization "${slug}".`);
  }

  const removed = await db
    .delete(user)
    .where(like(user.email, `%@${DEMO_EMAIL_DOMAIN}`))
    .returning({ id: user.id });
  if (removed.length > 0)
    console.log(`Deleted ${removed.length} demo user(s).`);
}

async function createUsers() {
  // Better Auth owns the password format; borrow its hasher rather than
  // reimplementing it, and skip signUpEmail so no verification mail is sent.
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(DEMO_PASSWORD);

  const ids = new Map<PersonKey, string>();

  for (const person of PEOPLE) {
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, person.email))
      .limit(1);

    if (existing) {
      ids.set(person.key, existing.id);
      continue;
    }

    const id = crypto.randomUUID();
    await db.insert(user).values({
      id,
      name: person.name,
      email: person.email,
      emailVerified: true,
      createdAt: daysAgo(180),
      updatedAt: daysAgo(180),
    });
    await db.insert(userAccount).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: passwordHash,
      createdAt: daysAgo(180),
      updatedAt: daysAgo(180),
    });
    ids.set(person.key, id);
  }

  console.log(
    `Created ${PEOPLE.length} demo user(s) (password: ${DEMO_PASSWORD}).`,
  );
  return ids;
}

async function main() {
  assertDevelopment();

  const slug = option("slug") ?? "northwind";
  const orgName = option("name") ?? "Northwind Labs";
  // Defaults to the configured development administrator, so the demo org is
  // reachable from the account you already sign in with.
  const ownerEmail = option("owner") ?? process.env.SEED_ADMIN_EMAIL;

  const [conflict] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);

  if (conflict && !flag("reset")) {
    throw new Error(
      `Organization "${slug}" already exists. Re-run with --reset to delete it (and every demo user) and rebuild.`,
    );
  }
  if (flag("reset")) await resetDemoData(slug);

  const userIds = await createUsers();

  // -- organization + membership ------------------------------------------
  const organizationId = crypto.randomUUID();
  await db.insert(organization).values({
    id: organizationId,
    name: orgName,
    slug,
    createdAt: daysAgo(180),
  });

  const memberIds = new Map<PersonKey, string>();
  for (const person of PEOPLE) {
    const id = crypto.randomUUID();
    await db.insert(member).values({
      id,
      organizationId,
      userId: userIds.get(person.key) as string,
      role: person.orgRole,
      createdAt: daysAgo(175),
    });
    memberIds.set(person.key, id);
  }

  // An existing account (usually the superadmin you sign in with) joins as a
  // second owner, so the demo org is reachable without the demo credentials.
  let ownerMemberId: string | null = null;
  if (ownerEmail) {
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, ownerEmail))
      .limit(1);
    if (!row) {
      console.warn(`--owner: no user with email ${ownerEmail}; skipping.`);
    } else {
      ownerMemberId = crypto.randomUUID();
      await db.insert(member).values({
        id: ownerMemberId,
        organizationId,
        userId: row.id,
        role: "owner",
        createdAt: daysAgo(175),
      });
      console.log(`Added ${ownerEmail} to "${slug}" as an owner.`);
    }
  }

  // -- org-level vocabulary (the afterCreateOrganization hook's job) -------
  await seedOrganizationProjectRoles(organizationId);
  await seedOrganizationWorkItemTypes(organizationId);
  await seedOrganizationDefaultCalendar(organizationId);

  const roleRows = await db
    .select({ id: projectRole.id, key: projectRole.key })
    .from(projectRole)
    .where(eq(projectRole.organizationId, organizationId));
  const roleByKey = new Map(roleRows.map((row) => [row.key, row.id]));

  const typeRows = await db
    .select({ id: workItemType.id, key: workItemType.key })
    .from(workItemType)
    .where(eq(workItemType.organizationId, organizationId));
  const typeByKey = new Map(typeRows.map((row) => [row.key, row.id]));

  const [calendar] = await db
    .select({ id: holidayCalendar.id })
    .from(holidayCalendar)
    .where(
      and(
        eq(holidayCalendar.organizationId, organizationId),
        eq(holidayCalendar.isDefault, true),
      ),
    )
    .limit(1);

  // -- holidays ------------------------------------------------------------
  const year = Number(today.slice(0, 4));
  await db.insert(holiday).values(
    [year, year + 1].flatMap((holidayYear) =>
      HOLIDAY_TEMPLATES.map((entry) => ({
        calendarId: calendar.id,
        date: `${holidayYear}-${String(entry.month).padStart(2, "0")}-${String(entry.day).padStart(2, "0")}`,
        name: entry.name,
      })),
    ),
  );

  // -- working patterns + leave -------------------------------------------
  await db.insert(memberCapacityProfile).values(
    PEOPLE.map((person) => ({
      organizationId,
      memberId: memberIds.get(person.key) as string,
      hoursPerDay: person.hoursPerDay,
      workingWeekdays: person.workingWeekdays,
      holidayCalendarId: calendar.id,
    })),
  );

  const leaveSeeds: {
    person: PersonKey;
    start: number;
    days: number;
    type: "vacation" | "sick" | "personal" | "training";
    status: "planned" | "confirmed";
  }[] = [
    {
      person: "priya",
      start: -3,
      days: 3,
      type: "vacation",
      status: "confirmed",
    },
    { person: "kwame", start: 4, days: 5, type: "vacation", status: "planned" },
    { person: "tomas", start: -10, days: 1, type: "sick", status: "confirmed" },
    { person: "lena", start: 9, days: 2, type: "training", status: "planned" },
    {
      person: "sofia",
      start: 16,
      days: 10,
      type: "vacation",
      status: "planned",
    },
  ];
  await db.insert(memberLeave).values(
    leaveSeeds.map((entry) => ({
      organizationId,
      memberId: memberIds.get(entry.person) as string,
      startDate: addDaysIso(today, entry.start),
      endDate: addDaysIso(today, entry.start + entry.days - 1),
      portion: 1,
      type: entry.type,
      status: entry.status,
      createdByMemberId: memberIds.get("daniel") as string,
    })),
  );

  // -- teams ---------------------------------------------------------------
  for (const seed of TEAMS) {
    const teamId = crypto.randomUUID();
    await db.insert(team).values({
      id: teamId,
      organizationId,
      name: seed.name,
      description: seed.description,
      source: "local",
    });
    await db.insert(teamMember).values(
      seed.members.map((person) => ({
        teamId,
        memberId: memberIds.get(person) as string,
      })),
    );
  }

  // -- custom fields -------------------------------------------------------
  const bugTypeId = typeByKey.get("bug") as string;
  const severityFieldId = crypto.randomUUID();
  const customerFieldId = crypto.randomUUID();
  await db.insert(workItemField).values([
    {
      id: severityFieldId,
      organizationId,
      key: "severity",
      label: "Severity",
      description:
        "Customer impact of the defect, independent of scheduling priority.",
      fieldType: "single_select",
      options: [
        { value: "s1", label: "S1 — Outage" },
        { value: "s2", label: "S2 — Major" },
        { value: "s3", label: "S3 — Minor" },
        { value: "s4", label: "S4 — Cosmetic" },
      ],
      appliesToTypeIds: [bugTypeId],
      isRequired: false,
      helpText: "S1 and S2 page the on-call engineer.",
      placement: "side",
      position: 0,
    },
    {
      id: customerFieldId,
      organizationId,
      key: "customer",
      label: "Customer",
      description: "The account that asked for this, when it came from one.",
      fieldType: "text",
      options: [],
      appliesToTypeIds: [],
      isRequired: false,
      placement: "side",
      position: 1,
    },
  ]);

  const CUSTOMERS = [
    "Vireo Health",
    "Kestrel Freight",
    "Northsea Energy",
    "Lumen Retail",
  ];

  // -- projects ------------------------------------------------------------
  const auditRows: (typeof auditLog.$inferInsert)[] = [];
  const notificationRows: (typeof notification.$inferInsert)[] = [];
  const commentableItems: {
    id: string;
    key: string;
    summary: string;
    projectId: string;
    projectKey: string;
    assignee: PersonKey;
    members: PersonKey[];
  }[] = [];

  const amara = { id: userIds.get("amara") as string, email: PEOPLE[0].email };

  auditRows.push({
    organizationId,
    actorId: amara.id,
    actorEmail: amara.email,
    action: "organization.created",
    targetType: "organization",
    targetId: organizationId,
    metadata: { name: orgName, slug },
    createdAt: daysAgo(180),
  });

  for (const seed of PROJECTS) {
    const projectId = crypto.randomUUID();
    await db.insert(project).values({
      id: projectId,
      organizationId,
      key: seed.key,
      name: seed.name,
      description: seed.description,
      capacityUnit: seed.capacityUnit,
      sprintLengthDays: 14,
      defaultHoursPerDay: 8,
      workingWeekdays: [1, 2, 3, 4, 5],
      timezone: "UTC",
      holidayCalendarId: calendar.id,
      createdAt: daysAgo(150),
    });

    auditRows.push({
      organizationId,
      actorId: amara.id,
      actorEmail: amara.email,
      action: "project.created",
      targetType: "project",
      targetId: projectId,
      metadata: { key: seed.key, name: seed.name },
      createdAt: daysAgo(150),
    });

    await db.insert(projectMember).values([
      ...seed.members.map((entry) => ({
        id: crypto.randomUUID(),
        projectId,
        memberId: memberIds.get(entry.person) as string,
        roleId: roleByKey.get(entry.roleKey) as string,
      })),
      ...(ownerMemberId
        ? [
            {
              id: crypto.randomUUID(),
              projectId,
              memberId: ownerMemberId,
              roleId: roleByKey.get("product_owner") as string,
            },
          ]
        : []),
    ]);

    await seedProjectWorkflowStatuses({ organizationId, projectId });

    const statusRows = await db
      .select({ id: workflowStatus.id, name: workflowStatus.name })
      .from(workflowStatus)
      .where(eq(workflowStatus.projectId, projectId));
    const statusByName = new Map(statusRows.map((row) => [row.name, row.id]));

    // -- sprints -----------------------------------------------------------
    const sprintSeeds = [
      { sequence: 1, offset: -35, state: "completed" as const },
      { sequence: 2, offset: -21, state: "completed" as const },
      { sequence: 3, offset: -7, state: "active" as const },
      { sequence: 4, offset: 7, state: "planning" as const },
    ];

    const sprintIds: Record<number, string> = {};
    for (const entry of sprintSeeds) {
      const startDate = addDaysIso(today, entry.offset);
      const id = crypto.randomUUID();
      await db.insert(sprint).values({
        id,
        organizationId,
        projectId,
        sequence: entry.sequence,
        name: `${seed.key} Sprint ${entry.sequence}`,
        goal:
          entry.state === "planning"
            ? "Not committed yet — planning in progress."
            : `Land the committed ${seed.epics[0].summary.toLowerCase()} work and keep the defect count flat.`,
        startDate,
        endDate: sprintEndFrom(startDate, 14),
        state: entry.state,
        capacityUnit: seed.capacityUnit,
        timezone: "UTC",
        workingWeekdays: [1, 2, 3, 4, 5],
        startedAt: entry.state === "planning" ? null : daysAgo(-entry.offset),
        closedAt:
          entry.state === "completed" ? daysAgo(-entry.offset - 13) : null,
        closedByMemberId:
          entry.state === "completed"
            ? (memberIds.get("daniel") as string)
            : null,
      });
      sprintIds[entry.sequence] = id;

      // Builds the per-member capacity rows from the working patterns, the
      // holiday calendar and the leave written above.
      await seedSprintCapacities(id);

      if (entry.state !== "planning") {
        auditRows.push({
          organizationId,
          actorId: userIds.get("daniel") as string,
          actorEmail: PEOPLE[1].email,
          action: "sprint.started",
          targetType: "sprint",
          targetId: id,
          metadata: {
            name: `${seed.key} Sprint ${entry.sequence}`,
            projectKey: seed.key,
          },
          createdAt: daysAgo(-entry.offset),
        });
      }
    }

    // -- work items --------------------------------------------------------
    let number = 1;
    let rank = INITIAL_RANK;
    const nextRank = () => {
      const value = rank;
      rank = between(rank, null);
      return value;
    };

    const assignable = seed.members
      .filter((entry) => entry.roleKey !== "viewer")
      .map((entry) => entry.person);
    const reporter = memberIds.get("amara") as string;

    const committed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const completed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const fieldValueRows: (typeof workItemFieldValue.$inferInsert)[] = [];

    for (const epicSeed of seed.epics) {
      const epicId = crypto.randomUUID();
      const epicNumber = number++;
      await db.insert(workItem).values({
        id: epicId,
        organizationId,
        projectId,
        number: epicNumber,
        typeId: typeByKey.get("epic") as string,
        statusId: statusByName.get("In progress") as string,
        summary: epicSeed.summary,
        description: `Umbrella for the ${epicSeed.summary.toLowerCase()} work. Tracked to the quarter, delivered feature by feature.`,
        priority: "high",
        businessValue: "high",
        riskLevel: "medium",
        assigneeMemberId: memberIds.get("amara") as string,
        reporterMemberId: reporter,
        startDate: addDaysIso(today, -60),
        dueDate: addDaysIso(today, 60),
        labels: [],
        rank: nextRank(),
        createdAt: daysAgo(140),
      });

      for (const featureSeed of epicSeed.features) {
        const featureId = crypto.randomUUID();
        const featureNumber = number++;
        await db.insert(workItem).values({
          id: featureId,
          organizationId,
          projectId,
          number: featureNumber,
          typeId: typeByKey.get("feature") as string,
          statusId: statusByName.get(pick(["To do", "In progress"])) as string,
          parentId: epicId,
          summary: featureSeed.summary,
          description: `A shippable slice of "${epicSeed.summary}". Done when every child item is accepted and the feature flag is removed.`,
          priority: pick<WorkItemPriority>(["medium", "high"]),
          businessValue: pick<WorkItemValueLevel>(["medium", "high"]),
          riskLevel: pick<WorkItemValueLevel>(["low", "medium"]),
          assigneeMemberId: memberIds.get(pick(assignable)) as string,
          reporterMemberId: reporter,
          startDate: addDaysIso(today, -30),
          dueDate: addDaysIso(today, 30),
          labels: [pick(LABELS)],
          rank: nextRank(),
          createdAt: daysAgo(120),
        });

        for (const leaf of featureSeed.children) {
          // Distribution: enough finished work for velocity to mean something,
          // enough open work for the board to look alive.
          const roll = random();
          const bucket =
            roll < 0.35
              ? ("done-past" as const)
              : roll < 0.5
                ? ("done-active" as const)
                : roll < 0.68
                  ? ("in-progress" as const)
                  : roll < 0.78
                    ? ("in-review" as const)
                    : roll < 0.9
                      ? ("todo-sprint" as const)
                      : ("backlog" as const);

          const sprintSequence =
            bucket === "done-past"
              ? pick([1, 2])
              : bucket === "backlog"
                ? null
                : bucket === "todo-sprint"
                  ? pick([3, 4])
                  : 3;

          const statusName =
            bucket === "done-past" || bucket === "done-active"
              ? "Done"
              : bucket === "in-progress"
                ? "In progress"
                : bucket === "in-review"
                  ? "In review"
                  : "To do";

          const assignee =
            bucket === "backlog" && chance(0.5) ? null : pick(assignable);
          const points = leaf.size ?? null;
          const itemId = crypto.randomUUID();
          const itemNumber = number++;
          const isDefect = leaf.type === "bug";
          const completedAt =
            statusName === "Done"
              ? daysAgo(
                  sprintSequence === 1
                    ? int(22, 34)
                    : sprintSequence === 2
                      ? int(8, 20)
                      : int(1, 6),
                )
              : null;

          if (points && sprintSequence) {
            committed[sprintSequence] += points;
            if (statusName === "Done") completed[sprintSequence] += points;
          }

          await db.insert(workItem).values({
            id: itemId,
            organizationId,
            projectId,
            number: itemNumber,
            typeId: typeByKey.get(leaf.type) as string,
            statusId: statusByName.get(statusName) as string,
            parentId: featureId,
            sprintId: sprintSequence ? sprintIds[sprintSequence] : null,
            summary: leaf.summary,
            description:
              leaf.type === "story"
                ? describeStory(leaf.summary, seed.name)
                : leaf.type === "task"
                  ? describeTask(leaf.summary)
                  : `Reported by support against the current release. ${leaf.summary}.`,
            acceptanceCriteria:
              leaf.type === "story"
                ? acceptanceCriteriaFor(leaf.summary)
                : null,
            technicalNotes: chance(0.4)
              ? "Touches the shared service layer — coordinate with whoever holds the other half of the change before merging."
              : null,
            definitionOfDone: chance(0.3)
              ? "Merged, deployed to staging, verified by the reporter, and the runbook updated."
              : null,
            ...(isDefect ? defectFieldsFor(leaf.summary) : {}),
            businessValue: chance(0.7)
              ? pick<WorkItemValueLevel>(["low", "medium", "high", "critical"])
              : null,
            riskLevel: chance(0.6)
              ? pick<WorkItemValueLevel>(["low", "medium", "high"])
              : null,
            priority: isDefect
              ? pick<WorkItemPriority>(["high", "highest"])
              : pick<WorkItemPriority>([
                  "lowest",
                  "low",
                  "medium",
                  "medium",
                  "high",
                ]),
            points,
            assigneeMemberId: assignee
              ? (memberIds.get(assignee) as string)
              : null,
            reporterMemberId: reporter,
            startDate: sprintSequence ? addDaysIso(today, int(-30, -1)) : null,
            dueDate: sprintSequence ? addDaysIso(today, int(1, 30)) : null,
            labels: chance(0.6) ? [pick(LABELS)] : [],
            rank: nextRank(),
            completedAt,
            createdAt: daysAgo(int(20, 110)),
          });

          if (isDefect) {
            const severity = pick(["s1", "s2", "s3", "s4"]);
            fieldValueRows.push({
              workItemId: itemId,
              fieldId: severityFieldId,
              value: severity,
              textValue: severity.toUpperCase(),
            });
          }
          if (chance(0.25)) {
            const customer = pick(CUSTOMERS);
            fieldValueRows.push({
              workItemId: itemId,
              fieldId: customerFieldId,
              value: customer,
              textValue: customer,
            });
          }

          auditRows.push({
            organizationId,
            actorId: amara.id,
            actorEmail: amara.email,
            action: "workItem.created",
            targetType: "workItem",
            targetId: itemId,
            metadata: {
              key: `${seed.key}-${itemNumber}`,
              summary: leaf.summary,
              projectKey: seed.key,
            },
            createdAt: daysAgo(int(20, 110)),
          });

          if (assignee && commentableItems.length < 9 && chance(0.35)) {
            commentableItems.push({
              id: itemId,
              key: `${seed.key}-${itemNumber}`,
              summary: leaf.summary,
              projectId,
              projectKey: seed.key,
              assignee,
              members: assignable,
            });
          }

          if (assignee && chance(0.2)) {
            notificationRows.push({
              organizationId,
              recipientMemberId: memberIds.get(assignee) as string,
              actorId: amara.id,
              actorName: PEOPLE[0].name,
              actorEmail: amara.email,
              action: "workItem.assigned",
              targetType: "workItem",
              targetId: itemId,
              metadata: {
                key: `${seed.key}-${itemNumber}`,
                summary: leaf.summary,
                projectKey: seed.key,
              },
              readAt: chance(0.5) ? daysAgo(int(1, 5)) : null,
              createdAt: daysAgo(int(1, 14)),
            });
          }
        }
      }
    }

    if (fieldValueRows.length > 0) {
      await db.insert(workItemFieldValue).values(fieldValueRows);
    }

    // Roll the item estimates up onto the sprints they were committed to.
    for (const entry of sprintSeeds) {
      await db
        .update(sprint)
        .set({
          committedPoints: committed[entry.sequence],
          completedPoints: completed[entry.sequence],
        })
        .where(eq(sprint.id, sprintIds[entry.sequence]));
    }

    console.log(
      `Seeded project ${seed.key} — ${number - 1} work items, 4 sprints.`,
    );
  }

  // -- comments, replies, reactions ---------------------------------------
  for (const item of commentableItems) {
    const author = pick(item.members);
    const responder = pick(item.members.filter((person) => person !== author));
    const mentioned = item.assignee;
    const mentionedMemberId = memberIds.get(mentioned) as string;
    const mentionedName =
      PEOPLE.find((person) => person.key === mentioned)?.name ?? "";

    const rootId = crypto.randomUUID();
    const rootBody = `Picked this up. The tricky part is the edge case where the request lands twice — <span data-type="mention" data-id="${mentionedMemberId}" data-label="${mentionedName}"></span> can you confirm the expected behaviour before I write the test?`;

    await db.insert(workItemComment).values({
      id: rootId,
      organizationId,
      projectId: item.projectId,
      workItemId: item.id,
      authorKind: "human",
      authorMemberId: memberIds.get(author) as string,
      authorId: userIds.get(author) as string,
      authorName: PEOPLE.find((person) => person.key === author)?.name,
      authorEmail: PEOPLE.find((person) => person.key === author)?.email,
      body: rootBody,
      mentionedMemberIds: [mentionedMemberId],
      createdAt: daysAgo(int(3, 12)),
    });

    const replyId = crypto.randomUUID();
    await db.insert(workItemComment).values({
      id: replyId,
      organizationId,
      projectId: item.projectId,
      workItemId: item.id,
      parentId: rootId,
      authorKind: "human",
      authorMemberId: mentionedMemberId,
      authorId: userIds.get(mentioned) as string,
      authorName: mentionedName,
      authorEmail: PEOPLE.find((person) => person.key === mentioned)?.email,
      body: "Confirmed — the second request should be a no-op and return the first result. Added that to the acceptance criteria.",
      mentionedMemberIds: [],
      createdAt: daysAgo(int(1, 3)),
    });

    await db.insert(workItemComment).values({
      id: crypto.randomUUID(),
      organizationId,
      projectId: item.projectId,
      workItemId: item.id,
      authorKind: "human",
      authorMemberId: memberIds.get(responder) as string,
      authorId: userIds.get(responder) as string,
      authorName: PEOPLE.find((person) => person.key === responder)?.name,
      authorEmail: PEOPLE.find((person) => person.key === responder)?.email,
      body: "Staging looks good after the last deploy. Leaving this in review until the reporter has had a look.",
      mentionedMemberIds: [],
      createdAt: daysAgo(1),
    });

    await db
      .insert(workItemCommentReaction)
      .values(
        [author, responder, mentioned]
          .slice(0, int(1, 3))
          .map((person, index) => ({
            organizationId,
            commentId: index === 0 ? rootId : replyId,
            memberId: memberIds.get(person) as string,
            emoji: pick(["👍", "🎉", "🚀", "👀"]),
          })),
      )
      // The same person can land twice when the assignee is also the responder.
      .onConflictDoNothing();

    notificationRows.push({
      organizationId,
      recipientMemberId: mentionedMemberId,
      actorId: userIds.get(author) as string,
      actorName: PEOPLE.find((person) => person.key === author)?.name,
      actorEmail: PEOPLE.find((person) => person.key === author)?.email,
      action: "workItem.mentioned",
      targetType: "workItem",
      targetId: item.id,
      metadata: {
        key: item.key,
        summary: item.summary,
        projectKey: item.projectKey,
        preview:
          "can you confirm the expected behaviour before I write the test?",
      },
      readAt: null,
      createdAt: daysAgo(int(1, 4)),
    });
  }

  // One assistant-authored comment, so the AI rendering path has an example.
  const aiTarget = commentableItems[0];
  if (aiTarget) {
    await db.insert(workItemComment).values({
      id: crypto.randomUUID(),
      organizationId,
      projectId: aiTarget.projectId,
      workItemId: aiTarget.id,
      authorKind: "ai",
      aiModel: "demo-model",
      body: "Summary of the thread so far: the behaviour on a duplicate request is now agreed (idempotent, returns the first result), the acceptance criteria have been updated, and the only open question is whether the retry budget belongs in this item or in a follow-up.",
      mentionedMemberIds: [],
      createdAt: daysAgo(1),
    });
  }

  if (notificationRows.length > 0) {
    await db.insert(notification).values(notificationRows);
  }
  if (auditRows.length > 0) {
    await db.insert(auditLog).values(auditRows);
  }

  console.log("");
  console.log(`Demo organization ready: /app/${slug}`);
  console.log(`  people        ${PEOPLE.length} (password ${DEMO_PASSWORD})`);
  console.log(`  sign in as    ${PEOPLE[0].email}`);
  console.log(`  teams         ${TEAMS.length}`);
  console.log(
    `  projects      ${PROJECTS.map((entry) => entry.key).join(", ")}`,
  );
  console.log(`  comments      ${commentableItems.length * 3 + 1}`);
  console.log(`  notifications ${notificationRows.length}`);
  console.log(`  audit rows    ${auditRows.length}`);
  console.log("");
  console.log(
    "Embeddings are not generated by this script — run `pnpm embeddings:backfill` if you need semantic search.",
  );
}

main()
  .catch((error) => {
    console.error("Failed to seed demo data:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
